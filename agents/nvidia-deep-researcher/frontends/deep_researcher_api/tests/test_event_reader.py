"""Tests for backend selection and owner-derived Cloudflare tenancy."""

from __future__ import annotations

import pytest

from deep_researcher_api.jobs import event_reader


class MemoryStorage:
    def __init__(self, *, tenant: str):
        self.tenant = tenant

    async def aget_events(self, job_id: str, *, after: int, limit: int):
        return {
            "events": [
                {"sequence": 4, "event": {"type": "progress", "data": {"step": "read"}}},
                {"sequence": 5, "event": {"type": "complete"}},
            ]
        }

    def get_events(self, job_id: str, *, after: int, limit: int):
        return {
            "events": [
                {"sequence": 4, "event": {"type": "progress"}},
            ]
        }


def test_tenant_key_is_stable_and_does_not_expose_owner():
    first = event_reader.tenant_for_job_owner("oauth", "person@example.test")
    second = event_reader.tenant_for_job_owner("oauth", "person@example.test")
    other = event_reader.tenant_for_job_owner("oauth", "another@example.test")

    assert first == second
    assert first.startswith("user_")
    assert "person" not in first
    assert first != other


def test_tenant_key_rejects_missing_owner():
    with pytest.raises(ValueError):
        event_reader.tenant_for_job_owner("", "subject")
    with pytest.raises(ValueError):
        event_reader.tenant_for_job_owner("oauth", "")


@pytest.mark.asyncio
async def test_cloudflare_reader_uses_persisted_owner_and_preserves_cursor(monkeypatch):
    monkeypatch.setenv("NEXORA_RESEARCH_EVENT_STORE", "cloudflare")
    owners = []

    def owner_lookup(job_id, db_url):
        owners.append((job_id, db_url))
        return {"owner_auth_type": "oauth", "owner_subject": "verified-user-42"}

    captured = {}

    def storage_factory(*, tenant):
        captured["tenant"] = tenant
        return MemoryStorage(tenant=tenant)

    events = await event_reader.get_events_async(
        "sqlite:///jobs.db",
        "job_123",
        after_id=3,
        limit=50,
        owner_lookup=owner_lookup,
        storage_factory=storage_factory,
    )

    assert owners == [("job_123", "sqlite:///jobs.db")]
    assert captured["tenant"] == event_reader.tenant_for_job_owner("oauth", "verified-user-42")
    assert [event["_id"] for event in events] == [4, 5]
    assert events[0]["data"]["step"] == "read"


@pytest.mark.asyncio
async def test_cloudflare_reader_fails_closed_without_owner(monkeypatch):
    monkeypatch.setenv("NEXORA_RESEARCH_EVENT_STORE", "cloudflare")

    with pytest.raises(event_reader.EventReaderConfigurationError):
        await event_reader.get_events_async(
            "sqlite:///jobs.db",
            "job_123",
            owner_lookup=lambda job_id, db_url: None,
            storage_factory=lambda **kwargs: MemoryStorage(**kwargs),
        )


def test_sql_is_default(monkeypatch):
    monkeypatch.delenv("NEXORA_RESEARCH_EVENT_STORE", raising=False)
    assert event_reader.cloudflare_events_enabled() is False


def test_writer_factory_selects_cloudflare_with_persisted_tenant(monkeypatch):
    from deep_researcher_api.jobs.cloudflare_event_store import CloudflareEventStore

    monkeypatch.setenv("NEXORA_RESEARCH_EVENT_STORE", "cloudflare")
    writer = event_reader.build_event_store_for_job(
        "sqlite:///jobs.db",
        "job_123",
        owner_lookup=lambda job_id, db_url: {
            "owner_auth_type": "oauth",
            "owner_subject": "verified-user-42",
        },
        storage_factory=lambda **kwargs: MemoryStorage(**kwargs),
    )

    assert isinstance(writer, CloudflareEventStore)
    assert writer.storage.tenant == event_reader.tenant_for_job_owner("oauth", "verified-user-42")


@pytest.mark.asyncio
async def test_cloudflare_reader_collects_multiple_durable_object_pages(monkeypatch):
    class PagedStorage:
        def __init__(self, *, tenant: str):
            self.tenant = tenant

        async def aget_events(self, job_id: str, *, after: int, limit: int):
            start = max(after + 1, 1)
            end = min(start + limit - 1, 450)
            return {
                "events": [
                    {"sequence": seq, "event": {"type": "progress", "data": {"n": seq}}}
                    for seq in range(start, end + 1)
                ]
            }

    monkeypatch.setenv("NEXORA_RESEARCH_EVENT_STORE", "cloudflare")
    events = await event_reader.get_events_async(
        "sqlite:///jobs.db",
        "job_456",
        after_id=0,
        limit=450,
        owner_lookup=lambda job_id, db_url: {
            "owner_auth_type": "oauth",
            "owner_subject": "verified-user-42",
        },
        storage_factory=lambda **kwargs: PagedStorage(**kwargs),
    )

    assert len(events) == 450
    assert events[0]["_id"] == 1
    assert events[-1]["_id"] == 450


@pytest.mark.asyncio
async def test_runner_uses_shared_event_writer_factory(monkeypatch):
    from deep_researcher_api.jobs import runner

    marker = object()
    captured = {}

    def writer_factory(db_url, job_id, *, content_cipher=None):
        captured.update(db_url=db_url, job_id=job_id, content_cipher=content_cipher)
        return marker

    monkeypatch.setattr(event_reader, "build_event_store_for_job", writer_factory)
    cipher = object()
    writer = await runner._create_event_store_for_job(
        "sqlite:///jobs.db",
        "job_789",
        content_cipher=cipher,
    )

    assert writer is marker
    assert captured == {
        "db_url": "sqlite:///jobs.db",
        "job_id": "job_789",
        "content_cipher": cipher,
    }
