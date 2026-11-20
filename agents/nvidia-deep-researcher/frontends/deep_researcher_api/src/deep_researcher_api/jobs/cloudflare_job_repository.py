"""Cloudflare-native job metadata repository.

This is a bounded metadata repository, not a replacement for NAT JobStore:
Dask future scheduling/cancellation and expiry cleanup remain separate adapters.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from pydantic import BaseModel

from .cloudflare_storage import CloudflareStorageClient, CloudflareStorageConflict


class CloudflareJobStatus(StrEnum):
    SUBMITTED = "submitted"
    RUNNING = "running"
    SUCCESS = "success"
    FAILURE = "failure"
    INTERRUPTED = "interrupted"
    NOT_FOUND = "not_found"


@dataclass
class CloudflareJobInfo:
    job_id: str
    status: str
    config_file: str | None
    error: str | None
    output_path: str | None
    created_at: datetime
    updated_at: datetime
    expiry_seconds: int
    output: str | None
    is_expired: bool = False
    runner_id: str | None = None
    heartbeat_at: datetime | None = None


class CloudflareJobMetadataRepository:
    """Async job metadata CRUD backed by tenant-scoped Durable Object records."""

    NAMESPACE = "jobs"
    MIN_EXPIRY = 600
    MAX_EXPIRY = 86400
    DEFAULT_EXPIRY = 3600
    ACTIVE_STATUS = {CloudflareJobStatus.RUNNING, CloudflareJobStatus.SUBMITTED}

    def __init__(self, storage: CloudflareStorageClient, *, conflict_retries: int = 5):
        if conflict_retries < 1:
            raise ValueError("conflict_retries must be positive")
        self.storage = storage
        self.conflict_retries = conflict_retries

    @staticmethod
    def _serialize(job: CloudflareJobInfo) -> dict[str, Any]:
        return {
            "job_id": job.job_id,
            "status": str(job.status),
            "config_file": job.config_file,
            "error": job.error,
            "output_path": job.output_path,
            "created_at": job.created_at.astimezone(UTC).isoformat(),
            "updated_at": job.updated_at.astimezone(UTC).isoformat(),
            "expiry_seconds": job.expiry_seconds,
            "output": job.output,
            "is_expired": job.is_expired,
            "runner_id": job.runner_id,
            "heartbeat_at": job.heartbeat_at.astimezone(UTC).isoformat() if job.heartbeat_at else None,
        }

    @staticmethod
    def _deserialize(value: dict[str, Any]) -> CloudflareJobInfo:
        required = {
            "job_id", "status", "created_at", "updated_at", "expiry_seconds",
        }
        if not isinstance(value, dict) or not required.issubset(value):
            raise ValueError("Stored job metadata is incomplete")
        created_at = datetime.fromisoformat(value["created_at"])
        updated_at = datetime.fromisoformat(value["updated_at"])
        heartbeat_at = datetime.fromisoformat(value["heartbeat_at"]) if value.get("heartbeat_at") else None
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=UTC)
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=UTC)
        if heartbeat_at is not None and heartbeat_at.tzinfo is None:
            heartbeat_at = heartbeat_at.replace(tzinfo=UTC)
        return CloudflareJobInfo(
            job_id=value["job_id"],
            status=value["status"],
            config_file=value.get("config_file"),
            error=value.get("error"),
            output_path=value.get("output_path"),
            created_at=created_at,
            updated_at=updated_at,
            expiry_seconds=int(value["expiry_seconds"]),
            output=value.get("output"),
            is_expired=bool(value.get("is_expired", False)),
            runner_id=value.get("runner_id"),
            heartbeat_at=heartbeat_at,
        )

    async def create_job(
        self,
        *,
        config_file: str | None = None,
        job_id: str | None = None,
        expiry_seconds: int = DEFAULT_EXPIRY,
    ) -> str:
        job_id = job_id or str(uuid.uuid4())
        if isinstance(expiry_seconds, bool) or not isinstance(expiry_seconds, int):
            raise ValueError("expiry_seconds must be an integer")
        expiry = max(self.MIN_EXPIRY, min(expiry_seconds, self.MAX_EXPIRY))
        now = datetime.now(UTC)
        job = CloudflareJobInfo(
            job_id=job_id,
            status=CloudflareJobStatus.SUBMITTED.value,
            config_file=config_file,
            error=None,
            output_path=None,
            created_at=now,
            updated_at=now,
            expiry_seconds=expiry,
            output=None,
        )
        # expected_revision=0 makes creation insert-only; an existing ID cannot
        # be overwritten by a second tenant-scoped submission.
        await self.storage.aput_record(self.NAMESPACE, job_id, self._serialize(job), expected_revision=0)
        return job_id

    async def get_job(self, job_id: str) -> CloudflareJobInfo | None:
        record = await self.storage.aget_record(self.NAMESPACE, job_id)
        if record is None:
            return None
        return self._deserialize(record["value"])

    async def get_status(self, job_id: str) -> CloudflareJobStatus:
        job = await self.get_job(job_id)
        return CloudflareJobStatus(job.status) if job else CloudflareJobStatus.NOT_FOUND

    async def update_status(
        self,
        job_id: str,
        status: str | CloudflareJobStatus,
        error: str | None = None,
        output_path: str | None = None,
        output: BaseModel | dict | list | str | None = None,
    ) -> None:
        status_value = status.value if isinstance(status, CloudflareJobStatus) else CloudflareJobStatus(status).value
        if isinstance(output, BaseModel):
            output_value = output.model_dump_json(round_trip=True)
        elif isinstance(output, dict | list):
            output_value = json.dumps(output, allow_nan=False)
        else:
            output_value = output

        for attempt in range(self.conflict_retries):
            record = await self.storage.aget_record(self.NAMESPACE, job_id)
            if record is None:
                raise ValueError(f"Job {job_id} not found in Cloudflare job repository")
            job = self._deserialize(record["value"])
            job.status = status_value
            job.error = error
            job.output_path = output_path
            job.output = output_value
            job.updated_at = datetime.now(UTC)
            try:
                await self.storage.aput_record(
                    self.NAMESPACE,
                    job_id,
                    self._serialize(job),
                    expected_revision=record["revision"],
                )
                return
            except CloudflareStorageConflict:
                if attempt + 1 == self.conflict_retries:
                    raise
        raise CloudflareStorageConflict("Job update exceeded conflict retry limit")

    async def claim_job(self, job_id: str, runner_id: str) -> bool:
        """Claim one submitted job with revision-checked compare-and-set semantics.

        A claim is successful for exactly one runner. A retry after a lost
        acknowledgement is deliberately not treated as a new claim; the caller
        must reconcile by reading the stored runner_id.
        """
        if not runner_id or not runner_id.strip():
            raise ValueError("runner_id must not be empty")
        for attempt in range(self.conflict_retries):
            record = await self.storage.aget_record(self.NAMESPACE, job_id)
            if record is None:
                return False
            job = self._deserialize(record["value"])
            if job.status != CloudflareJobStatus.SUBMITTED.value:
                return False
            now = datetime.now(UTC)
            job.status = CloudflareJobStatus.RUNNING.value
            job.runner_id = runner_id
            job.heartbeat_at = now
            job.updated_at = now
            try:
                await self.storage.aput_record(
                    self.NAMESPACE, job_id, self._serialize(job),
                    expected_revision=record["revision"],
                )
                return True
            except CloudflareStorageConflict:
                if attempt + 1 == self.conflict_retries:
                    raise
        return False

    async def heartbeat_job(self, job_id: str, runner_id: str) -> bool:
        """Refresh a running lease only when the caller still owns it."""
        for attempt in range(self.conflict_retries):
            record = await self.storage.aget_record(self.NAMESPACE, job_id)
            if record is None:
                return False
            job = self._deserialize(record["value"])
            if job.status != CloudflareJobStatus.RUNNING.value or job.runner_id != runner_id:
                return False
            now = datetime.now(UTC)
            job.heartbeat_at = now
            job.updated_at = now
            try:
                await self.storage.aput_record(
                    self.NAMESPACE, job_id, self._serialize(job),
                    expected_revision=record["revision"],
                )
                return True
            except CloudflareStorageConflict:
                if attempt + 1 == self.conflict_retries:
                    raise
        return False

    async def finish_job(
        self,
        job_id: str,
        runner_id: str,
        status: str | CloudflareJobStatus,
        *,
        error: str | None = None,
        output_path: str | None = None,
        output: BaseModel | dict | list | str | None = None,
    ) -> bool:
        """Persist a terminal result without allowing a stale runner to overwrite it."""
        status_value = status.value if isinstance(status, CloudflareJobStatus) else CloudflareJobStatus(status).value
        terminal = {
            CloudflareJobStatus.SUCCESS.value,
            CloudflareJobStatus.FAILURE.value,
            CloudflareJobStatus.INTERRUPTED.value,
        }
        if status_value not in terminal:
            raise ValueError("finish_job requires a terminal status")
        if isinstance(output, BaseModel):
            output_value = output.model_dump_json(round_trip=True)
        elif isinstance(output, dict | list):
            output_value = json.dumps(output, allow_nan=False)
        else:
            output_value = output

        for attempt in range(self.conflict_retries):
            record = await self.storage.aget_record(self.NAMESPACE, job_id)
            if record is None:
                return False
            job = self._deserialize(record["value"])
            if job.status != CloudflareJobStatus.RUNNING.value or job.runner_id != runner_id:
                return False
            job.status = status_value
            job.error = error
            job.output_path = output_path
            job.output = output_value
            job.runner_id = None
            job.updated_at = datetime.now(UTC)
            try:
                await self.storage.aput_record(
                    self.NAMESPACE, job_id, self._serialize(job),
                    expected_revision=record["revision"],
                )
                return True
            except CloudflareStorageConflict:
                if attempt + 1 == self.conflict_retries:
                    raise
        return False

    async def mark_stale_jobs(self, *, stale_after_seconds: int, now: datetime | None = None) -> int:
        """Fence off jobs whose runner lease expired; never overwrite a fresh claim."""
        if isinstance(stale_after_seconds, bool) or not isinstance(stale_after_seconds, int) or stale_after_seconds < 1:
            raise ValueError("stale_after_seconds must be a positive integer")
        cutoff = (now or datetime.now(UTC)).astimezone(UTC) - timedelta(seconds=stale_after_seconds)
        marked = 0
        for snapshot in await self.get_all_jobs():
            if snapshot.status != CloudflareJobStatus.RUNNING.value:
                continue
            last_seen = snapshot.heartbeat_at or snapshot.updated_at
            if last_seen.astimezone(UTC) >= cutoff:
                continue
            for attempt in range(self.conflict_retries):
                record = await self.storage.aget_record(self.NAMESPACE, snapshot.job_id)
                if record is None:
                    break
                current = self._deserialize(record["value"])
                current_last_seen = current.heartbeat_at or current.updated_at
                if (
                    current.status != CloudflareJobStatus.RUNNING.value
                    or current.runner_id != snapshot.runner_id
                    or current_last_seen.astimezone(UTC) >= cutoff
                ):
                    break
                current.status = CloudflareJobStatus.INTERRUPTED.value
                current.error = "Runner lease expired before the job completed."
                current.runner_id = None
                current.updated_at = datetime.now(UTC)
                try:
                    await self.storage.aput_record(
                        self.NAMESPACE, snapshot.job_id, self._serialize(current),
                        expected_revision=record["revision"],
                    )
                    marked += 1
                    break
                except CloudflareStorageConflict:
                    if attempt + 1 == self.conflict_retries:
                        raise
        return marked

    async def get_all_jobs(self) -> list[CloudflareJobInfo]:
        jobs: list[CloudflareJobInfo] = []
        cursor: str | None = None
        while True:
            page = await self.storage.alist_records(self.NAMESPACE, after=cursor, limit=200)
            jobs.extend(self._deserialize(item["value"]) for item in page.get("records", []))
            cursor = page.get("nextAfter")
            if cursor is None:
                return jobs

    async def get_jobs_by_status(self, status: str | CloudflareJobStatus) -> list[CloudflareJobInfo]:
        status_value = status.value if isinstance(status, CloudflareJobStatus) else CloudflareJobStatus(status).value
        return [job for job in await self.get_all_jobs() if job.status == status_value]

    async def get_last_job(self) -> CloudflareJobInfo | None:
        jobs = await self.get_all_jobs()
        return max(jobs, key=lambda job: job.created_at, default=None)

    def get_expires_at(self, job: CloudflareJobInfo) -> datetime | None:
        if job.status in self.ACTIVE_STATUS:
            return None
        updated_at = job.updated_at if job.updated_at.tzinfo else job.updated_at.replace(tzinfo=UTC)
        return updated_at + timedelta(seconds=job.expiry_seconds)
