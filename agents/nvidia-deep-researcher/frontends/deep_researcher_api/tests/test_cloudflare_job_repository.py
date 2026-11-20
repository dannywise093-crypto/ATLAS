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


def test_only_one_runner_can_claim_a_submitted_job():
    async def run():
        storage = _MemoryStorage()
        repository = CloudflareJobMetadataRepository(storage)
        await repository.create_job(job_id="job-claim")
        claims = await asyncio.gather(
            repository.claim_job("job-claim", "runner-a"),
            repository.claim_job("job-claim", "runner-b"),
        )
        assert sorted(claims) == [False, True]
        job = await repository.get_job("job-claim")
        assert job.status == "running"
        assert job.runner_id in {"runner-a", "runner-b"}
        assert job.heartbeat_at is not None
    asyncio.run(run())


def test_runner_lease_guards_heartbeat_and_terminal_updates():
    async def run():
        storage = _MemoryStorage()
        repository = CloudflareJobMetadataRepository(storage)
        await repository.create_job(job_id="job-lease")
        assert await repository.claim_job("job-lease", "runner-a") is True
        assert await repository.heartbeat_job("job-lease", "runner-b") is False
        assert await repository.finish_job("job-lease", "runner-b", "success", output="wrong") is False
        assert await repository.heartbeat_job("job-lease", "runner-a") is True
        assert await repository.finish_job("job-lease", "runner-a", "success", output={"ok": True}) is True
        assert await repository.finish_job("job-lease", "runner-a", "failure") is False
        job = await repository.get_job("job-lease")
        assert job.status == "success"
        assert job.runner_id is None
        assert job.output == '{"ok": true}'
    asyncio.run(run())


def test_stale_runner_lease_is_interrupted_without_overwriting_fresh_jobs():
    async def run():
        storage = _MemoryStorage()
        repository = CloudflareJobMetadataRepository(storage)
        await repository.create_job(job_id="job-stale")
        await repository.create_job(job_id="job-fresh")
        assert await repository.claim_job("job-stale", "runner-old") is True
        assert await repository.claim_job("job-fresh", "runner-live") is True

        stale_record = storage.records[(repository.NAMESPACE, "job-stale")]
        stale_record["value"]["heartbeat_at"] = "2020-01-01T00:00:00+00:00"
        stale_record["value"]["updated_at"] = "2020-01-01T00:00:00+00:00"
        count = await repository.mark_stale_jobs(stale_after_seconds=60)
        assert count == 1

        stale = await repository.get_job("job-stale")
        fresh = await repository.get_job("job-fresh")
        assert stale.status == "interrupted"
        assert stale.runner_id is None
        assert fresh.status == "running"
        assert fresh.runner_id == "runner-live"
    asyncio.run(run())


def test_finish_job_rejects_non_terminal_status():
    async def run():
        repository = CloudflareJobMetadataRepository(_MemoryStorage())
        with pytest.raises(ValueError, match="terminal status"):
            await repository.finish_job("missing", "runner-a", "running")
    asyncio.run(run())
