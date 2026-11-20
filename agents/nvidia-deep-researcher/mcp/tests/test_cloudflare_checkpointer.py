from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from langgraph.checkpoint.base import WRITES_IDX_MAP

_MODULE_PATH = (
    Path(__file__).resolve().parents[2]
    / "src"
    / "deep_researcher_agent"
    / "common"
    / "cloudflare_checkpointer.py"
)
_SPEC = importlib.util.spec_from_file_location("nexora_cloudflare_checkpointer", _MODULE_PATH)
assert _SPEC is not None and _SPEC.loader is not None
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)
CloudflareCheckpointSaver = _MODULE.CloudflareCheckpointSaver


def _saver() -> CloudflareCheckpointSaver:
    return CloudflareCheckpointSaver(
        base_url="https://research.example.test",
        token="t" * 40,
        tenant="nexora-test",
    )


@pytest.mark.asyncio
async def test_restore_latest_checkpoint_and_pending_writes(monkeypatch):
    saver = _saver()
    checkpoint = {"id": "cp-2", "channel_values": {"answer": "persisted"}}
    metadata = {"source": "test", "step": 2}
    row = {
        "checkpoint_type": "msgpack",
        "checkpoint_r2_key": "nexora-checkpoints/nexora-test/checkpoint",
        "checkpoint_sha256": "a" * 64,
        "checkpoint_bytes": 10,
        "metadata_type": "msgpack",
        "metadata_r2_key": "nexora-checkpoints/nexora-test/metadata",
        "metadata_sha256": "b" * 64,
        "metadata_bytes": 8,
        "parent_checkpoint_id": "cp-1",
    }

    async def coordinator(config, action, payload=None):
        if action == "get-thread":
            return {"thread": {"head_checkpoint_id": "cp-2", "revision": 2}}
        if action == "get":
            return {"checkpoint": row}
        if action == "list-writes":
            return {"writes": [{
                "task_id": "task-1",
                "channel": "answer",
                "value_type": "msgpack",
                "value_r2_key": "nexora-checkpoints/nexora-test/write-1",
                "value_sha256": "c" * 64,
                "value_bytes": 4,
            }]}
        raise AssertionError(action)

    async def download(descriptor):
        if descriptor["sha256"] == "a" * 64:
            return checkpoint
        if descriptor["sha256"] == "b" * 64:
            return metadata
        if descriptor["sha256"] == "c" * 64:
            return "restored pending value"
        raise AssertionError("Unexpected checkpoint payload descriptor")

    monkeypatch.setattr(saver, "_coordinator", coordinator)
    monkeypatch.setattr(saver, "_download", download)
    result = await saver.aget_tuple({"configurable": {"thread_id": "thread-1"}})

    assert result is not None
    assert result.checkpoint == checkpoint
    assert result.metadata == metadata
    assert result.config["configurable"]["checkpoint_id"] == "cp-2"
    assert result.parent_config["configurable"]["checkpoint_id"] == "cp-1"
    assert result.pending_writes == [("task-1", "answer", "restored pending value")]


@pytest.mark.asyncio
async def test_publish_uses_parent_revision_and_fencing_lease(monkeypatch):
    saver = _saver()
    calls = []
    lease = {
        "leaseId": "lease-1",
        "holderId": saver.holder_id,
        "fencingToken": 7,
        "expiresAt": 999999,
    }

    async def upload(kind, value):
        return {
            "type": "msgpack",
            "key": f"nexora-checkpoints/nexora-test/{kind}",
            "sha256": "c" * 64,
            "bytes": 12,
        }

    async def acquire(config):
        return lease

    async def coordinator(config, action, payload=None):
        calls.append((action, payload))
        if action == "get-thread":
            return {"thread": {"head_checkpoint_id": "cp-1", "revision": 4}}
        if action == "publish":
            return {"checkpointId": "cp-2", "revision": 5}
        return {"released": True}

    monkeypatch.setattr(saver, "_upload", upload)
    monkeypatch.setattr(saver, "_lease", acquire)
    monkeypatch.setattr(saver, "_coordinator", coordinator)
    monkeypatch.setattr(saver, "_release", lambda config, value: _resolved())

    result = await saver.aput(
        {"configurable": {"thread_id": "thread-1", "checkpoint_id": "cp-1"}},
        {"id": "cp-2", "channel_values": {}},
        {"source": "test"},
        {"answer": 1},
    )

    published = next(payload for action, payload in calls if action == "publish")
    assert published["checkpoint"]["parentCheckpointId"] == "cp-1"
    assert published["checkpoint"]["expectedRevision"] == 4
    assert published["fencingToken"] == 7
    assert result["configurable"]["checkpoint_id"] == "cp-2"


async def _resolved():
    return None


@pytest.mark.asyncio
async def test_pending_writes_use_langgraph_reserved_indices(monkeypatch):
    saver = _saver()
    calls = []
    lease = {"leaseId": "lease-2", "holderId": saver.holder_id, "fencingToken": 2}

    async def upload(kind, value):
        return {
            "type": "msgpack",
            "key": f"nexora-checkpoints/nexora-test/{kind}-{value}",
            "sha256": "d" * 64,
            "bytes": 4,
        }

    async def coordinator(config, action, payload=None):
        calls.append((action, payload))
        return {"accepted": 1, "requested": 1}

    monkeypatch.setattr(saver, "_upload", upload)
    monkeypatch.setattr(saver, "_lease", lambda config: _resolved_value(lease))
    monkeypatch.setattr(saver, "_coordinator", coordinator)
    monkeypatch.setattr(saver, "_release", lambda config, value: _resolved())

    await saver.aput_writes(
        {"configurable": {"thread_id": "thread-1", "checkpoint_id": "cp-1"}},
        [("__error__", "failed")],
        "task-1",
        "node-a",
    )
    payload = calls[0][1]
    assert payload["writes"][0]["writeIndex"] == WRITES_IDX_MAP["__error__"]
    assert payload["writes"][0]["taskPath"] == "node-a"


async def _resolved_value(value):
    return value

@pytest.mark.asyncio
async def test_thread_delete_uses_encoded_tenant_and_thread_scope(monkeypatch):
    saver = _saver()
    calls = []

    async def call(method, path, payload=None):
        calls.append((method, path, payload))
        return {"tombstoned": True}

    monkeypatch.setattr(saver, "_call", call)
    await saver.adelete_thread("thread:with-colon")
    assert calls == [(
        "POST",
        "/internal/checkpoint-threads/nexora-test/thread%3Awith-colon/delete",
        {},
    )]


def test_typed_serializer_round_trips_checkpoint_and_metadata():
    saver = _saver()
    values = [
        {"id": "cp-1", "channel_values": {"answer": "durable"}},
        {"source": "test", "step": 4},
        ["write", 42, {"ok": True}],
    ]
    for value in values:
        type_name, payload = saver.serde.dumps_typed(value)
        assert saver.serde.loads_typed((type_name, payload)) == value
