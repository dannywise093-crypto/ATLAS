# SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Cloudflare Durable Object adapter for the MCP JobStore contract.

This replaces only the MCP job ledger. LangGraph checkpoints and todo progress
remain on the configured checkpoint database until their separate migration is
complete; selecting this adapter is therefore a partial migration, not a
Cloudflare-only production configuration.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen

import asyncpg

from .job_store import Job, JobDepth, JobState

_DEFAULT_TTL_SECONDS = 24 * 60 * 60
_MAX_RECORD_BYTES = 256 * 1024  # Must match research-worker/storage.js.
_NAMESPACE = "mcp-jobs"
_TERMINAL_STATES = frozenset({"complete", "failed"})
_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed


class CloudflareStorageConflict(RuntimeError):
    """The Durable Object rejected a stale record revision."""


class _CloudflareMCPStorageClient:
    """Small stdlib-only transport so the standalone MCP image needs no API package."""

    def __init__(self, *, tenant: str) -> None:
        if (
            not tenant
            or len(tenant) > 128
            or not tenant[0].isalnum()
            or not all(char.isascii() and (char.isalnum() or char in "._-") for char in tenant)
        ):
            raise ValueError("Invalid NEXORA_RESEARCH_TENANT")
        self.tenant = tenant
        self.base_url = os.environ.get("NEXORA_RESEARCH_STORAGE_URL", "").rstrip("/")
        self.token = os.environ.get("NEXORA_RESEARCH_API_TOKEN", "")
        if len(self.token) < 32:
            raise ValueError("NEXORA_RESEARCH_API_TOKEN must contain at least 32 characters")
        parsed = urlsplit(self.base_url)
        local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if parsed.scheme != "https" and not local_http:
            raise ValueError("NEXORA_RESEARCH_STORAGE_URL must use HTTPS")
        if (
            not parsed.hostname
            or parsed.path not in {"", "/"}
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("NEXORA_RESEARCH_STORAGE_URL must be an origin without credentials or query")

    def _url(self, suffix: str) -> str:
        return (
            f"{self.base_url}/internal/storage/v1/tenants/"
            f"{quote(self.tenant, safe='')}/{suffix}"
        )

    def _request(self, method: str, url: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None if payload is None else json.dumps(
            payload, separators=(",", ":"), allow_nan=False
        ).encode("utf-8")
        request = Request(
            url,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if data is not None else {}),
            },
        )
        try:
            with urlopen(request, timeout=15.0) as response:
                raw = response.read(1024 * 1024 + 1)
                if len(raw) > 1024 * 1024:
                    raise RuntimeError("Cloudflare storage response exceeded 1 MiB")
                return json.loads(raw.decode("utf-8")) if raw else {}
        except HTTPError as exc:
            if exc.code == 409:
                raise CloudflareStorageConflict("Cloudflare storage revision conflict") from exc
            if exc.code == 404:
                return {}
            raise RuntimeError(f"Cloudflare storage returned HTTP {exc.code}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise RuntimeError("Cloudflare storage request failed") from exc

    async def aget_record(self, namespace: str, key: str) -> dict[str, Any] | None:
        url = self._url(f"records/{quote(namespace, safe='')}/{quote(key, safe='')}")
        result = await asyncio.to_thread(self._request, "GET", url)
        return result or None

    async def aput_record(
        self, namespace: str, key: str, value: dict[str, Any], *, expected_revision: int
    ) -> dict[str, Any]:
        url = self._url(f"records/{quote(namespace, safe='')}/{quote(key, safe='')}")
        payload = {"value": value, "expectedRevision": expected_revision}
        payload_size = len(json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8"))
        if payload_size > _MAX_RECORD_BYTES:
            raise ValueError(
                "MCP job record exceeds the Cloudflare 256 KiB limit; R2 report storage is required"
            )
        return await asyncio.to_thread(self._request, "PUT", url, payload)

    async def alist_records(
        self, namespace: str, *, after: str | None = None, limit: int = 200
    ) -> dict[str, Any]:
        query = {"limit": min(limit, 200)}
        if after is not None:
            query["after"] = after
        url = self._url(f"records/{quote(namespace, safe='')}?{urlencode(query)}")
        return await asyncio.to_thread(self._request, "GET", url)

    async def adelete_record(self, namespace: str, key: str) -> dict[str, Any]:
        url = self._url(f"records/{quote(namespace, safe='')}/{quote(key, safe='')}")
        return await asyncio.to_thread(self._request, "DELETE", url)


class CloudflareMCPJobStore:
    """Implements the MCP JobStore API over tenant-scoped DO records."""

    def __init__(
        self,
        storage: Any,
        *,
        checkpoint_db_url: str,
        checkpoint_schema: str = "public",
        conflict_retries: int = 5,
    ) -> None:
        if conflict_retries < 1:
            raise ValueError("conflict_retries must be positive")
        if not _IDENTIFIER_RE.fullmatch(checkpoint_schema):
            raise ValueError("Invalid checkpoint schema identifier")
        self._storage = storage
        self._checkpoint_db_url = checkpoint_db_url
        self._checkpoint_schema = f'"{checkpoint_schema}"'
        self._pool: asyncpg.Pool | None = None
        self._conflict_retries = conflict_retries

    @classmethod
    def from_env(cls, *, checkpoint_db_url: str) -> "CloudflareMCPJobStore":
        """Build the storage client without ever accepting credentials as arguments."""
        tenant = os.environ.get("NEXORA_RESEARCH_TENANT", "").strip()
        if not tenant:
            raise ValueError("NEXORA_RESEARCH_TENANT is required for the Cloudflare MCP job store")
        schema = os.environ.get("DEEP_RESEARCHER_CHECKPOINT_SCHEMA", "public").strip()
        return cls(
            _CloudflareMCPStorageClient(tenant=tenant),
            checkpoint_db_url=checkpoint_db_url,
            checkpoint_schema=schema,
        )

    @property
    def pool(self) -> asyncpg.Pool | None:
        """Share the checkpoint DB pool with the todo reader when available."""
        return self._pool

    async def init(self) -> None:
        if self._pool is None:
            self._pool = await asyncpg.create_pool(dsn=self._checkpoint_db_url)

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    @staticmethod
    def _job_from_value(value: dict[str, Any]) -> Job:
        required = {
            "job_id", "principal", "query", "depth", "state", "poll_count",
            "created_at", "updated_at", "expires_at",
        }
        if not isinstance(value, dict) or not required.issubset(value):
            raise ValueError("Stored MCP job record is incomplete")

        def timestamp(name: str) -> datetime:
            parsed = datetime.fromisoformat(value[name])
            return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed

        heartbeat = value.get("heartbeat_at")
        return Job(
            job_id=value["job_id"],
            principal=value["principal"],
            query=value["query"],
            depth=value["depth"],
            state=value["state"],
            result=value.get("result"),
            error=value.get("error"),
            poll_count=int(value["poll_count"]),
            created_at=timestamp("created_at"),
            updated_at=timestamp("updated_at"),
            expires_at=timestamp("expires_at"),
            runner_id=value.get("runner_id"),
            heartbeat_at=(
                _parse_timestamp(heartbeat) if heartbeat else None
            ),
        )

    @staticmethod
    def _serialize(job: Job) -> dict[str, Any]:
        return {
            "job_id": job.job_id,
            "principal": job.principal,
            "query": job.query,
            "depth": job.depth,
            "state": job.state,
            "result": job.result,
            "error": job.error,
            "poll_count": job.poll_count,
            "runner_id": job.runner_id,
            "heartbeat_at": job.heartbeat_at.astimezone(UTC).isoformat() if job.heartbeat_at else None,
            "created_at": job.created_at.astimezone(UTC).isoformat(),
            "updated_at": job.updated_at.astimezone(UTC).isoformat(),
            "expires_at": job.expires_at.astimezone(UTC).isoformat(),
        }

    async def _read(self, job_id: str) -> dict[str, Any] | None:
        return await self._storage.aget_record(_NAMESPACE, job_id)

    async def _write(self, job_id: str, value: dict[str, Any], revision: int) -> None:
        await self._storage.aput_record(
            _NAMESPACE, job_id, value, expected_revision=revision
        )

    async def create(
        self,
        *,
        principal: str,
        query: str,
        depth: JobDepth,
        state: JobState,
        result: str | None = None,
        ttl_seconds: int = _DEFAULT_TTL_SECONDS,
    ) -> str:
        if isinstance(ttl_seconds, bool) or not isinstance(ttl_seconds, int) or ttl_seconds < 1:
            raise ValueError("ttl_seconds must be a positive integer")
        now = datetime.now(UTC)
        job_id = str(uuid.uuid4())
        job = Job(
            job_id=job_id,
            principal=principal,
            query=query,
            depth=depth,
            state=state,
            result=result,
            error=None,
            poll_count=0,
            created_at=now,
            updated_at=now,
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
        await self._storage.aput_record(
            _NAMESPACE, job_id, self._serialize(job), expected_revision=0
        )
        return job_id

    async def get(self, job_id: str) -> Job | None:
        record = await self._read(job_id)
        return self._job_from_value(record["value"]) if record is not None else None

    async def mark_running(self, job_id: str, runner_id: str) -> bool:
        if not runner_id or not runner_id.strip():
            raise ValueError("runner_id must not be empty")
        for attempt in range(self._conflict_retries):
            record = await self._read(job_id)
            if record is None:
                return False
            job = self._job_from_value(record["value"])
            if job.state != "queued":
                return False
            now = datetime.now(UTC)
            job.state = "running"
            job.runner_id = runner_id
            job.heartbeat_at = now
            job.updated_at = now
            try:
                await self._write(job_id, self._serialize(job), record["revision"])
                return True
            except CloudflareStorageConflict:
                if attempt + 1 == self._conflict_retries:
                    raise
        return False

    async def mark_failed_if_queued_or_owned(self, job_id: str, runner_id: str, error: str) -> bool:
        for attempt in range(self._conflict_retries):
            record = await self._read(job_id)
            if record is None:
                return False
            job = self._job_from_value(record["value"])
            if job.state != "queued" and not (job.state == "running" and job.runner_id == runner_id):
                return False
            job.state = "failed"
            job.error = error
            job.updated_at = datetime.now(UTC)
            job.runner_id = None
            try:
                await self._write(job_id, self._serialize(job), record["revision"])
                return True
            except CloudflareStorageConflict:
                if attempt + 1 == self._conflict_retries:
                    raise
        return False

    async def heartbeat(self, job_id: str, runner_id: str) -> None:
        for attempt in range(self._conflict_retries):
            record = await self._read(job_id)
            if record is None:
                return
            job = self._job_from_value(record["value"])
            if job.state != "running" or job.runner_id != runner_id:
                return
            now = datetime.now(UTC)
            job.heartbeat_at = now
            job.updated_at = now
            try:
                await self._write(job_id, self._serialize(job), record["revision"])
                return
            except CloudflareStorageConflict:
                if attempt + 1 == self._conflict_retries:
                    raise

    async def update(
        self,
        job_id: str,
        *,
        state: JobState | None = None,
        result: str | None = None,
        error: str | None = None,
        from_states: tuple[JobState, ...] | None = None,
        runner_id: str | None = None,
    ) -> bool:
        for attempt in range(self._conflict_retries):
            record = await self._read(job_id)
            if record is None:
                return False
            job = self._job_from_value(record["value"])
            if from_states is not None and job.state not in from_states:
                return False
            if runner_id is not None and job.runner_id != runner_id:
                return False
            if state is not None:
                job.state = state
                if state in _TERMINAL_STATES:
                    job.runner_id = None
            if result is not None:
                job.result = result
            if error is not None:
                job.error = error
            job.updated_at = datetime.now(UTC)
            try:
                await self._write(job_id, self._serialize(job), record["revision"])
                return True
            except CloudflareStorageConflict:
                if attempt + 1 == self._conflict_retries:
                    raise
        return False

    async def record_poll(self, job_id: str, principal: str) -> Job | None:
        for attempt in range(self._conflict_retries):
            record = await self._read(job_id)
            if record is None:
                return None
            job = self._job_from_value(record["value"])
            if job.principal != principal:
                return None
            if job.state not in {"queued", "running"}:
                return job
            job.poll_count += 1
            try:
                await self._write(job_id, self._serialize(job), record["revision"])
                return job
            except CloudflareStorageConflict:
                if attempt + 1 == self._conflict_retries:
                    raise
        return None

    async def mark_stale_running_failed(self, *, stale_after_seconds: int, error: str) -> int:
        if isinstance(stale_after_seconds, bool) or not isinstance(stale_after_seconds, int) or stale_after_seconds < 1:
            raise ValueError("stale_after_seconds must be a positive integer")
        cutoff = datetime.now(UTC) - timedelta(seconds=stale_after_seconds)
        marked = 0
        cursor: str | None = None
        while True:
            page = await self._storage.alist_records(_NAMESPACE, after=cursor, limit=200)
            for item in page.get("records", []):
                job_id = item["key"]
                snapshot = self._job_from_value(item["value"])
                last_seen = snapshot.heartbeat_at or snapshot.updated_at
                if snapshot.state not in {"queued", "running"} or last_seen >= cutoff:
                    continue
                for attempt in range(self._conflict_retries):
                    current_record = await self._read(job_id)
                    if current_record is None:
                        break
                    current = self._job_from_value(current_record["value"])
                    current_seen = current.heartbeat_at or current.updated_at
                    if current.state not in {"queued", "running"} or current_seen >= cutoff:
                        break
                    current.state = "failed"
                    current.error = error
                    current.runner_id = None
                    current.updated_at = datetime.now(UTC)
                    try:
                        await self._write(job_id, self._serialize(current), current_record["revision"])
                        marked += 1
                        break
                    except CloudflareStorageConflict:
                        if attempt + 1 == self._conflict_retries:
                            raise
            cursor = page.get("nextAfter")
            if cursor is None:
                return marked

    async def delete_expired(self) -> int:
        """Delete expired terminal ledger rows and their SQL checkpoint threads.

        Checkpoints remain PostgreSQL-backed in this migration phase. Remove
        their writes/blobs/snapshots in one transaction before deleting the
        Durable Object job capability. If the DO delete fails, retrying is safe:
        the checkpoint DELETEs are idempotent and the job record remains.
        """
        if self._pool is None:
            raise RuntimeError("CloudflareMCPJobStore.init() must be called before use")
        now = datetime.now(UTC)
        deleted = 0
        cursor: str | None = None
        checkpoints = f"{self._checkpoint_schema}.checkpoints"
        blobs = f"{self._checkpoint_schema}.checkpoint_blobs"
        writes = f"{self._checkpoint_schema}.checkpoint_writes"
        while True:
            page = await self._storage.alist_records(_NAMESPACE, after=cursor, limit=200)
            for item in page.get("records", []):
                job = self._job_from_value(item["value"])
                if job.state not in _TERMINAL_STATES or job.expires_at >= now:
                    continue
                async with self._pool.acquire() as conn:
                    async with conn.transaction():
                        for table in (writes, blobs, checkpoints):
                            await conn.execute(
                                f"DELETE FROM {table} WHERE thread_id = $1",
                                job.job_id,
                            )
                await self._storage.adelete_record(_NAMESPACE, job.job_id)
                deleted += 1
            cursor = page.get("nextAfter")
            if cursor is None:
                return deleted
