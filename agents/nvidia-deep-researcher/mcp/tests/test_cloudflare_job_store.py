# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Cloudflare Durable Object adapter tests for the MCP JobStore contract."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from deep_researcher_mcp.cloudflare_job_store import CloudflareMCPJobStore


class CloudflareStorageConflict(Exception):
    pass


class _MemoryStorage:
    def __init__(self) -> None:
        self.records: dict[tuple[str, str], dict] = {}

    async def aget_record(self, namespace: str, key: str):
        return self.records.get((namespace, key))

    async def aput_record(self, namespace: str, key: str, value: dict, *, expected_revision=None):
        current = self.records.get((namespace, key))
        revision = current["revision"] if current else 0
        if expected_revision is not None and expected_revision != revision:
            raise CloudflareStorageConflict("revision conflict")
        self.records[(namespace, key)] = {"value": value, "revision": revision + 1}
        return {"revision": revision + 1}

    async def alist_records(self, namespace: str, *, after=None, limit=100):
        rows = [
            {"key": key, **value}
            for (ns, key), value in sorted(self.records.items())
            if ns == namespace and (after is None or key > after)
        ]
        page = rows[:limit]
        return {
            "records": page,
            "nextAfter": page[-1]["key"] if len(rows) > limit else None,
        }

    async def adelete_record(self, namespace: str, key: str):
        self.records.pop((namespace, key), None)


class _Connection:
    def __init__(self):
        self.deleted_tables: list[str] = []

    async def execute(self, statement: str, job_id: str):
        self.deleted_tables.append(statement.split("DELETE FROM ", 1)[1].split(" ", 1)[0])


class _Context:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, *_):
        return False


class _Pool:
    def __init__(self):
        self.connection = _Connection()
        self.closed = False

    def acquire(self):
        return _Context(self.connection)

    def transaction(self):
        return _Context(self)

    async def close(self):
        self.closed = True


def _store(storage=None):
    return CloudflareMCPJobStore(
        storage or _MemoryStorage(),
        checkpoint_db_url="postgresql://unused/test",
    )


@pytest.mark.asyncio
async def test_mcp_job_contract_create_claim_heartbeat_and_finish():
    storage = _MemoryStorage()
    store = _store(storage)
    await store.init()
    job_id = await store.create(
        principal="anonymous",
        query="research question",
        depth="deep",
        state="queued",
    )

    created = await store.get(job_id)
    assert created is not None
    assert created.state == "queued"
    assert created.principal == "anonymous"
    assert created.query == "research question"

    claims = await asyncio.gather(
        store.mark_running(job_id, "runner-a"),
        store.mark_running(job_id, "runner-b"),
    )
    assert sorted(claims) == [False, True]

    running = await store.get(job_id)
    assert running is not None
    owner = running.runner_id
    assert owner in {"runner-a", "runner-b"}

    await store.heartbeat(job_id, "not-the-owner")
    assert (await store.get(job_id)).runner_id == owner
    await store.heartbeat(job_id, owner)
    assert (await store.get(job_id)).heartbeat_at is not None

    assert await store.update(
        job_id,
        state="complete",
        result="report",
        from_states=("running",),
        runner_id=owner,
    )
    finished = await store.get(job_id)
    assert finished is not None
    assert finished.state == "complete"
    assert finished.result == "report"
    assert finished.runner_id is None
    await store.close()


@pytest.mark.asyncio
async def test_poll_is_principal_scoped_and_only_increments_active_jobs():
    store = _store()
    job_id = await store.create(
        principal="principal-a",
        query="q",
        depth="shallow",
        state="queued",
    )
    assert await store.record_poll(job_id, "principal-b") is None
    polled = await store.record_poll(job_id, "principal-a")
    assert polled is not None and polled.poll_count == 1
    assert await store.update(job_id, state="complete", result="done")
    terminal = await store.record_poll(job_id, "principal-a")
    assert terminal is not None and terminal.poll_count == 1


@pytest.mark.asyncio
async def test_failed_transition_and_stale_job_reconciliation_are_fenced():
    storage = _MemoryStorage()
    store = _store(storage)
    old_id = await store.create(
        principal="anonymous", query="old", depth="deep", state="queued"
    )
    fresh_id = await store.create(
        principal="anonymous", query="fresh", depth="deep", state="queued"
    )
    assert await store.mark_running(old_id, "runner-old")
    assert await store.mark_running(fresh_id, "runner-live")

    old_record = storage.records[("mcp-jobs", old_id)]
    old_value = old_record["value"]
    old_value["heartbeat_at"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    old_value["updated_at"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()

    marked = await store.mark_stale_running_failed(
        stale_after_seconds=60,
        error="stale",
    )
    assert marked == 1
    assert (await store.get(old_id)).state == "failed"
    assert (await store.get(fresh_id)).state == "running"

    assert await store.mark_failed_if_queued_or_owned(fresh_id, "wrong-runner", "no")
    assert (await store.get(fresh_id)).state == "failed"


@pytest.mark.asyncio
async def test_expiry_cleanup_removes_checkpoint_rows_before_job_capability(monkeypatch):
    storage = _MemoryStorage()
    store = _store(storage)
    pool = _Pool()
    monkeypatch.setattr("deep_researcher_mcp.cloudflare_job_store.asyncpg.create_pool", lambda **_: _return(pool))
    await store.init()

    job_id = await store.create(
        principal="anonymous", query="done", depth="deep", state="complete", result="report"
    )
    record = storage.records[("mcp-jobs", job_id)]
    record["value"]["expires_at"] = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()

    assert await store.delete_expired() == 1
    assert ("mcp-jobs", job_id) not in storage.records
    assert len(pool.connection.deleted_tables) == 3
    assert pool.connection.deleted_tables == [
        '"public".checkpoint_writes',
        '"public".checkpoint_blobs',
        '"public".checkpoints',
    ]
    await store.close()
    assert pool.closed


async def _return(value):
    return value
