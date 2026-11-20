# SPDX-FileCopyrightText: Copyright (c) 2026, NEXORA-AI contributors.
# SPDX-License-Identifier: Apache-2.0

"""LangGraph async checkpoint saver backed by the NEXORA Cloudflare Worker.

The Worker owns authentication, tenant scoping, lease fencing, D1 metadata and
R2 payload integrity. This client deliberately has no direct Cloudflare keys.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from collections.abc import AsyncIterator, Iterator, Sequence
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    CheckpointTuple,
    WRITES_IDX_MAP,
    get_checkpoint_id,
)
from langchain_core.runnables import RunnableConfig

logger = logging.getLogger(__name__)
_MAX_RESPONSE_BYTES = 40 * 1024 * 1024
_MAX_OBJECT_BYTES = 32 * 1024 * 1024


class CloudflareCheckpointError(RuntimeError):
    """The durable checkpoint service rejected or could not fulfill an operation."""


class CloudflareCheckpointSaver(BaseCheckpointSaver):
    """Async LangGraph saver using D1 indexes and immutable R2 serialized objects."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        token: str | None = None,
        tenant: str | None = None,
        serde: Any = None,
        timeout: float = 30.0,
    ) -> None:
        super().__init__(serde=serde)
        self.base_url = (base_url or os.getenv("NEXORA_RESEARCH_STORAGE_URL", "")).rstrip("/")
        self.token = token or os.getenv("NEXORA_RESEARCH_API_TOKEN", "")
        self.tenant = tenant or os.getenv("NEXORA_RESEARCH_TENANT", "")
        self.timeout = timeout
        if not self.base_url.startswith("https://") and not self.base_url.startswith("http://127.0.0.1"):
            raise ValueError("NEXORA_RESEARCH_STORAGE_URL must be HTTPS")
        if len(self.token) < 32:
            raise ValueError("NEXORA_RESEARCH_API_TOKEN must contain at least 32 characters")
        if not self.tenant or len(self.tenant) > 128 or not self.tenant[0].isalnum() or not all(
            char.isascii() and (char.isalnum() or char in "._-") for char in self.tenant
        ):
            raise ValueError("NEXORA_RESEARCH_TENANT is invalid")
        self.holder_id = "saver-" + uuid.uuid4().hex

    def _request(self, method: str, path: str, body: bytes | None = None, *, content_type: str = "application/json") -> tuple[int, bytes, dict[str, str]]:
        request = Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={
                "Authorization": "Bearer " + self.token,
                "Accept": "application/json, application/octet-stream",
                **({"Content-Type": content_type} if body is not None else {}),
            },
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                payload = response.read(_MAX_RESPONSE_BYTES + 1)
                if len(payload) > _MAX_RESPONSE_BYTES:
                    raise CloudflareCheckpointError("Checkpoint response exceeded the configured limit")
                return response.status, payload, {k.lower(): v for k, v in response.headers.items()}
        except HTTPError as exc:
            detail = exc.read(4096).decode("utf-8", "replace")
            if exc.code == 404:
                return 404, b"", {}
            raise CloudflareCheckpointError(f"Checkpoint service returned HTTP {exc.code}: {detail}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise CloudflareCheckpointError("Checkpoint service request failed") from exc

    async def _call(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any] | None:
        body = None if payload is None else json.dumps(payload, separators=(",", ":"), allow_nan=False).encode()
        status, raw, _ = await asyncio.to_thread(self._request, method, path, body)
        if status == 404:
            return None
        return json.loads(raw.decode()) if raw else {}

    async def _upload(self, kind: str, value: Any) -> dict[str, Any]:
        type_name, blob = self.serde.dumps_typed(value)
        if len(blob) > _MAX_OBJECT_BYTES:
            raise CloudflareCheckpointError("Serialized checkpoint object exceeds 32 MiB")
        path = f"/internal/checkpoint-objects/{quote(self.tenant, safe='')}/objects"
        status, raw, _ = await asyncio.to_thread(self._request, "POST", path, blob, content_type="application/octet-stream")
        result = json.loads(raw.decode())
        if status != 201 or result.get("size") != len(blob) or not result.get("objectId") or not result.get("sha256"):
            raise CloudflareCheckpointError("Checkpoint object upload did not return a verified descriptor")
        return {
            "type": type_name,
            "key": f"nexora-checkpoints/{self.tenant}/{result['objectId']}",
            "sha256": result["sha256"],
            "bytes": result["size"],
            "kind": kind,
        }

    async def _download(self, descriptor: dict[str, Any]) -> Any:
        key = descriptor.get("key", "")
        prefix = f"nexora-checkpoints/{self.tenant}/"
        if not isinstance(key, str) or not key.startswith(prefix):
            raise CloudflareCheckpointError("Checkpoint object descriptor is outside the configured tenant")
        object_id = key[len(prefix):]
        path = f"/internal/checkpoint-objects/{quote(self.tenant, safe='')}/objects/{quote(object_id, safe='')}"
        status, raw, headers = await asyncio.to_thread(self._request, "GET", path)
        if status != 200 or len(raw) != descriptor.get("bytes") or headers.get("x-checkpoint-sha256") != descriptor.get("sha256"):
            raise CloudflareCheckpointError("Checkpoint object failed size or SHA-256 verification")
        return self.serde.loads_typed((descriptor["type"], raw))

    def _scope(self, config: RunnableConfig) -> tuple[str, str, str, str]:
        configurable = config.get("configurable") or {}
        thread_id = configurable.get("thread_id")
        namespace = configurable.get("checkpoint_ns", "")
        if not isinstance(thread_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,255}", thread_id):
            raise ValueError("LangGraph config requires a valid thread_id")
        if (
            not isinstance(namespace, str)
            or len(namespace) > 256
            or any(ord(char) < 32 for char in namespace)
        ):
            raise ValueError("LangGraph checkpoint_ns is invalid")
        encoded_ns = urlencode({"namespace": namespace})
        prefix = (
            f"/internal/checkpoint-coordinator/{quote(self.tenant, safe='')}/"
            f"{quote(thread_id, safe='')}"
        )
        return thread_id, namespace, prefix, encoded_ns

    async def _coordinator(self, config: RunnableConfig, action: str, payload: dict[str, Any] | None = None) -> dict[str, Any] | None:
        _, _, prefix, query = self._scope(config)
        return await self._call("POST", f"{prefix}/{action}?{query}", payload or {})

    async def _lease(self, config: RunnableConfig) -> dict[str, Any]:
        lease = await self._coordinator(config, "acquire", {"holderId": self.holder_id, "ttlMs": 120000})
        if not lease:
            raise CloudflareCheckpointError("Checkpoint coordinator did not issue a lease")
        return lease

    async def _release(self, config: RunnableConfig, lease: dict[str, Any]) -> None:
        try:
            await self._coordinator(config, "release", {"holderId": self.holder_id, **lease})
        except Exception:
            logger.warning("Checkpoint lease release failed; expiry will recover it", exc_info=True)

    async def aget_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        thread_id, namespace, _, _ = self._scope(config)
        configurable = config.get("configurable") or {}
        checkpoint_id = get_checkpoint_id(config)
        if checkpoint_id is None:
            thread = await self._coordinator(config, "get-thread")
            thread_row = (thread or {}).get("thread") or {}
            checkpoint_id = thread_row.get("head_checkpoint_id")
            if not checkpoint_id:
                return None
        response = await self._coordinator(config, "get", {"checkpointId": checkpoint_id})
        if not response or not response.get("checkpoint"):
            return None
        row = response["checkpoint"]
        checkpoint = await self._download({
            "type": row["checkpoint_type"], "key": row["checkpoint_r2_key"],
            "sha256": row["checkpoint_sha256"], "bytes": row["checkpoint_bytes"],
        })
        metadata = await self._download({
            "type": row["metadata_type"], "key": row["metadata_r2_key"],
            "sha256": row["metadata_sha256"], "bytes": row["metadata_bytes"],
        })
        writes_response = await self._coordinator(config, "list-writes", {"checkpointId": checkpoint_id})
        pending_writes = []
        for item in (writes_response or {}).get("writes", []):
            value = await self._download({
                "type": item["value_type"], "key": item["value_r2_key"],
                "sha256": item["value_sha256"], "bytes": item["value_bytes"],
            })
            pending_writes.append((item["task_id"], item["channel"], value))
        # The coordinator returns rows ordered by task_path, task_id and write_index.
        # Preserve that LangGraph execution order; the checkpoint package does not
        # expose a stable public writes_sort_key helper across supported versions.
        result_config = {
            "configurable": {
                **{k: v for k, v in configurable.items() if k not in {"checkpoint_id"}},
                "thread_id": thread_id,
                "checkpoint_ns": namespace,
                "checkpoint_id": checkpoint_id,
            }
        }
        parent_id = row.get("parent_checkpoint_id")
        parent_config = None
        if parent_id:
            parent_config = {"configurable": {
                "thread_id": thread_id, "checkpoint_ns": namespace, "checkpoint_id": parent_id
            }}
        return CheckpointTuple(result_config, checkpoint, metadata, parent_config, pending_writes)

    async def alist(
        self, config: RunnableConfig | None, *, filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None, limit: int | None = None,
    ) -> AsyncIterator[CheckpointTuple]:
        if config is None:
            raise ValueError("Tenant-scoped checkpoint listing requires a thread config")
        self._scope(config)
        if limit is not None and (isinstance(limit, bool) or not isinstance(limit, int) or limit < 1):
            raise ValueError("Checkpoint list limit must be a positive integer")

        page_size = min(limit, 100) if limit is not None else 100
        cursor = get_checkpoint_id(before) if before else None
        yielded = 0

        while True:
            payload: dict[str, Any] = {"limit": page_size}
            if cursor:
                payload["beforeCheckpointId"] = cursor
            response = await self._coordinator(config, "list", payload)
            rows = (response or {}).get("checkpoints", [])
            if not rows:
                return

            for row in rows:
                item_config = {"configurable": {
                    **(config.get("configurable") or {}),
                    "checkpoint_id": row["checkpoint_id"],
                }}
                item = await self.aget_tuple(item_config)
                if item is None:
                    continue
                if filter and any(item.metadata.get(key) != value for key, value in filter.items()):
                    continue
                yield item
                yielded += 1
                if limit is not None and yielded >= limit:
                    return

            if len(rows) < page_size:
                return
            next_cursor = rows[-1]["checkpoint_id"]
            if next_cursor == cursor:
                raise CloudflareCheckpointError("Checkpoint listing did not advance its pagination cursor")
            cursor = next_cursor

    async def aput(
        self, config: RunnableConfig, checkpoint: dict[str, Any], metadata: dict[str, Any],
        new_versions: dict[str, Any],
    ) -> RunnableConfig:
        thread_id, namespace, _, _ = self._scope(config)
        checkpoint_id = checkpoint.get("id")
        if not isinstance(checkpoint_id, str) or not checkpoint_id:
            raise ValueError("LangGraph checkpoint must contain an id")
        parent_id = get_checkpoint_id(config)
        checkpoint_descriptor, metadata_descriptor = await asyncio.gather(
            self._upload("checkpoint", checkpoint), self._upload("metadata", metadata)
        )
        lease = await self._lease(config)
        try:
            thread_response = await self._coordinator(config, "get-thread")
            thread = (thread_response or {}).get("thread") or {
                "head_checkpoint_id": None, "revision": 0
            }
            if thread.get("head_checkpoint_id") != parent_id:
                raise CloudflareCheckpointError("Checkpoint parent is no longer the thread head")
            projection = json.dumps(metadata, separators=(",", ":"), allow_nan=False)
            versions = json.dumps(new_versions, separators=(",", ":"), allow_nan=False)
            result = await self._coordinator(config, "publish", {
                "holderId": self.holder_id,
                **lease,
                "checkpoint": {
                    "checkpointId": checkpoint_id,
                    "parentCheckpointId": parent_id,
                    "expectedRevision": int(thread.get("revision", 0)),
                    "checkpoint": checkpoint_descriptor,
                    "metadata": metadata_descriptor,
                    "metadataJson": projection,
                    "channelVersionsJson": versions,
                },
            })
            if not result:
                raise CloudflareCheckpointError("Checkpoint publication returned no result")
        finally:
            await self._release(config, lease)
        return {"configurable": {
            **(config.get("configurable") or {}),
            "thread_id": thread_id,
            "checkpoint_ns": namespace,
            "checkpoint_id": checkpoint_id,
        }}

    async def aput_writes(
        self, config: RunnableConfig, writes: Sequence[tuple[str, Any]],
        task_id: str, task_path: str = "",
    ) -> None:
        _, _, _, _ = self._scope(config)
        if not writes:
            return
        checkpoint_id = get_checkpoint_id(config)
        if not checkpoint_id:
            raise ValueError("Pending writes require checkpoint_id")
        payloads = await asyncio.gather(*(self._upload("write", value) for _, value in writes))
        from langgraph.checkpoint.base import WRITES_IDX_MAP
        write_rows = []
        for index, ((channel, _), descriptor) in enumerate(zip(writes, payloads, strict=True)):
            write_rows.append({
                "taskId": task_id, "taskPath": task_path,
                "writeIndex": WRITES_IDX_MAP.get(channel, index),
                "channel": channel, "value": descriptor,
            })
        lease = await self._lease(config)
        try:
            result = await self._coordinator(config, "put-writes", {
                "holderId": self.holder_id, **lease,
                "checkpointId": checkpoint_id, "writes": write_rows,
            })
            if result is None:
                raise CloudflareCheckpointError("Pending-write publication returned no result")
        finally:
            await self._release(config, lease)

    async def adelete_thread(self, thread_id: str) -> None:
        if not isinstance(thread_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,255}", thread_id):
            raise ValueError("A valid thread_id is required")
        path = (
            f"/internal/checkpoint-threads/{quote(self.tenant, safe='')}/"
            f"{quote(thread_id, safe='')}/delete"
        )
        result = await self._call("POST", path, {})
        if not result or result.get("tombstoned") is not True:
            raise CloudflareCheckpointError("Checkpoint thread deletion was not confirmed")

    # NAT's workflow executes asynchronously. Fail closed if a caller accidentally
    # selects this saver from a synchronous LangGraph execution path.
    def get_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        raise NotImplementedError("Use the async LangGraph execution API with CloudflareCheckpointSaver")

    def list(self, config: RunnableConfig | None, *, filter: dict[str, Any] | None = None,
             before: RunnableConfig | None = None, limit: int | None = None) -> Iterator[CheckpointTuple]:
        raise NotImplementedError("Use the async LangGraph execution API with CloudflareCheckpointSaver")

    def put(self, config: RunnableConfig, checkpoint: dict[str, Any], metadata: dict[str, Any],
            new_versions: dict[str, Any]) -> RunnableConfig:
        raise NotImplementedError("Use the async LangGraph execution API with CloudflareCheckpointSaver")

    def put_writes(self, config: RunnableConfig, writes: Sequence[tuple[str, Any]],
                   task_id: str, task_path: str = "") -> None:
        raise NotImplementedError("Use the async LangGraph execution API with CloudflareCheckpointSaver")

    def delete_thread(self, thread_id: str) -> None:
        raise NotImplementedError("Use the async LangGraph execution API with CloudflareCheckpointSaver")
