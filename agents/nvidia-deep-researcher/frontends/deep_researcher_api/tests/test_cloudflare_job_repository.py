from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest

from deep_researcher_api.jobs.cloudflare_job_repository import (
    CloudflareJobMetadataRepository,
    CloudflareJobStatus,
)
from deep_researcher_api.jobs.cloudflare_storage import CloudflareStorageConflict


class _MemoryStorage:
    def __init__(self):
        self.records = {}
        self.conflict_once = False

    async def aput_record(self, namespace, key, value, *, expected_revision=None):
        current = self.records.get((namespace, key))
        revision = current["revision"] if current else 0
        if expected_revision is not None and expected_revision != revision:
            raise CloudflareStorageConflict("conflict")
        if self.conflict_once:
            self.conflict_once = False
            raise CloudflareStorageConflict("simulated concurrent update")
        self.records[(namespace, key)] = {"value": value, "revision": revision + 1}
        return {"revision": revision + 1}

    async def aget_record(self, namespace, key):
        return self.records.get((namespace, key))

    async def alist_records(self, namespace, *, after=None, limit=100):
        rows = [
            {"key": key, **record}
            for (ns, key), record in sorted(self.records.items(), key=lambda item: item[0][1])
            if ns == namespace and (after is None or key > after)
        ]
        page = rows[:limit]
        return {"records": page, "nextAfter": page[-1]["key"] if len(rows) > limit else None}


def test_create_and_read_job_metadata():
    async def run():
        storage = _MemoryStorage()
        repository = CloudflareJobMetadataRepository(storage)
        job_id = await repository.create_job(job_id="job-1", config_file="research.yml", expiry_seconds=10)
        job = await repository.get_job(job_id)
        assert job is not None
        assert job.status == CloudflareJobStatus.SUBMITTED.value
        assert job.expiry_seconds == repository.MIN_EXPIRY
        assert job.config_file == "research.yml"
        assert await repository.get_status("missing") == CloudflareJobStatus.NOT_FOUND
    asyncio.run(run())


def test_update_status_retries_revision_conflict_and_serializes_output():
    async def run():
        storage = _MemoryStorage()
        repository = CloudflareJobMetadataRepository(storage)
        await repository.create_job(job_id="job-2")
        storage.conflict_once = True
        await repository.update_status("job-2", CloudflareJobStatus.SUCCESS, output={"answer": 42})
        job = await repository.get_job("job-2")
        assert job.status == "success"
        assert job.output == '{"answer": 42}'
    asyncio.run(run())


def test_job_listing_and_status_filtering_are_paginated():
    async def run():
        storage = _MemoryStorage()
        repository = CloudflareJobMetadataRepository(storage)
        for job_id in ("job-a", "job-b", "job-c"):
            await repository.create_job(job_id=job_id)
        await repository.update_status("job-b", "success")
        jobs = await repository.get_all_jobs()
        completed = await repository.get_jobs_by_status("success")
        assert [job.job_id for job in jobs] == ["job-a", "job-b", "job-c"]
        assert [job.job_id for job in completed] == ["job-b"]
        assert (await repository.get_last_job()).job_id in {"job-a", "job-b", "job-c"}
    asyncio.run(run())


def test_missing_job_update_fails_and_active_jobs_do_not_expire():
    async def run():
        repository = CloudflareJobMetadataRepository(_MemoryStorage())
        with pytest.raises(ValueError):
            await repository.update_status("missing", "running")
        now = datetime.now(UTC)
        from deep_researcher_api.jobs.cloudflare_job_repository import CloudflareJobInfo
        job = CloudflareJobInfo("job-x", "running", None, None, None, now, now, 3600, None)
        assert repository.get_expires_at(job) is None
    asyncio.run(run())
