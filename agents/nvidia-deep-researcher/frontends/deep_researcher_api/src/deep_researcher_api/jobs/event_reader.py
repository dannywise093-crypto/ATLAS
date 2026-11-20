"""Shared, tenant-aware event reader for SQL and Cloudflare storage.

Cloudflare mode is deliberately opt-in. The tenant is derived only from the
persisted job_access owner record; request-supplied tenant identifiers are
never accepted. SQL remains the default until the Cloudflare writer is enabled.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from typing import Any, Callable

from .cloudflare_event_store import CloudflareEventStore
from .cloudflare_storage import CloudflareStorageClient


class EventReaderConfigurationError(RuntimeError):
    """Cloudflare event reading cannot be configured safely."""


def cloudflare_events_enabled() -> bool:
    """Return whether the operator explicitly selected Cloudflare event reads."""
    return os.environ.get("NEXORA_RESEARCH_EVENT_STORE", "sql").strip().lower() == "cloudflare"


def tenant_for_job_owner(owner_auth_type: str, owner_subject: str) -> str:
    """Return a non-PII, stable Cloudflare tenant key for a persisted owner."""
    if not isinstance(owner_auth_type, str) or not owner_auth_type.strip():
        raise ValueError("Persisted owner auth type is required")
    if not isinstance(owner_subject, str) or not owner_subject.strip():
        raise ValueError("Persisted owner subject is required")
    material = f"{owner_auth_type.strip()}:{owner_subject}".encode("utf-8")
    return "user_" + hashlib.sha256(material).hexdigest()[:48]


def _storage_for_job(
    job_id: str,
    db_url: str,
    *,
    owner_lookup: Callable[[str, str], dict[str, Any] | None] | None = None,
    storage_factory: Callable[..., CloudflareStorageClient] = CloudflareStorageClient,
) -> CloudflareStorageClient:
    """Build a tenant-scoped storage client from the authoritative job owner row."""
    if owner_lookup is None:
        from .access import get_job_access

        owner_lookup = get_job_access
    access = owner_lookup(job_id, db_url)
    if not access:
        raise EventReaderConfigurationError("Cannot resolve persisted owner for Cloudflare event access")
    tenant = tenant_for_job_owner(
        str(access.get("owner_auth_type") or ""),
        str(access.get("owner_subject") or ""),
    )
    try:
        return storage_factory(tenant=tenant)
    except (TypeError, ValueError) as exc:
        raise EventReaderConfigurationError("Cloudflare event storage is not configured") from exc


async def get_events_async(
    db_url: str,
    job_id: str,
    after_id: int = 0,
    limit: int = 100,
    *,
    content_cipher: Any | None = None,
    owner_lookup: Callable[[str, str], dict[str, Any] | None] | None = None,
    storage_factory: Callable[..., CloudflareStorageClient] = CloudflareStorageClient,
) -> list[dict]:
    """Read events from the explicitly selected backend using the shared contract."""
    if not cloudflare_events_enabled():
        from .event_store import EventStore

        return await EventStore.get_events_async(db_url, job_id, after_id, limit)
    storage = await asyncio.to_thread(
        _storage_for_job,
        job_id,
        db_url,
        owner_lookup=owner_lookup,
        storage_factory=storage_factory,
    )
    if isinstance(after_id, bool) or not isinstance(after_id, int) or after_id < 0:
        raise ValueError("after_id must be a non-negative integer")
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        raise ValueError("limit must be a positive integer")
    adapter = CloudflareEventStore(storage, job_id, content_cipher=content_cipher)
    events: list[dict] = []
    cursor = after_id
    while len(events) < limit:
        page = await adapter.aget_events(after_id=cursor, limit=min(200, limit - len(events)))
        if not page:
            break
        events.extend(page)
        cursor = page[-1]["_id"]
        if len(page) < min(200, limit - (len(events) - len(page))):
            break
    return events


def build_event_store_for_job(
    db_url: str,
    job_id: str,
    *,
    content_cipher: Any | None = None,
    owner_lookup: Callable[[str, str], dict[str, Any] | None] | None = None,
    storage_factory: Callable[..., CloudflareStorageClient] = CloudflareStorageClient,
):
    """Build the matching event writer for the currently selected read backend."""
    if cloudflare_events_enabled():
        storage = _storage_for_job(
            job_id,
            db_url,
            owner_lookup=owner_lookup,
            storage_factory=storage_factory,
        )
        return CloudflareEventStore(storage, job_id, content_cipher=content_cipher)
    from .event_store import EventStore

    return EventStore(db_url, job_id, content_cipher=content_cipher)


def get_events_sync(
    db_url: str,
    job_id: str,
    after_id: int = 0,
    limit: int = 100,
    *,
    content_cipher: Any | None = None,
    owner_lookup: Callable[[str, str], dict[str, Any] | None] | None = None,
    storage_factory: Callable[..., CloudflareStorageClient] = CloudflareStorageClient,
) -> list[dict]:
    """Synchronous equivalent for non-async callers."""
    if not cloudflare_events_enabled():
        from .event_store import EventStore

        return EventStore.get_events(db_url, job_id, after_id, limit)
    storage = _storage_for_job(
        job_id,
        db_url,
        owner_lookup=owner_lookup,
        storage_factory=storage_factory,
    )
    if isinstance(after_id, bool) or not isinstance(after_id, int) or after_id < 0:
        raise ValueError("after_id must be a non-negative integer")
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        raise ValueError("limit must be a positive integer")
    adapter = CloudflareEventStore(storage, job_id, content_cipher=content_cipher)
    events: list[dict] = []
    cursor = after_id
    while len(events) < limit:
        page = adapter.get_events(after_id=cursor, limit=min(200, limit - len(events)))
        if not page:
            break
        previous_count = len(events)
        events.extend(page)
        cursor = page[-1]["_id"]
        requested = min(200, limit - previous_count)
        if len(page) < requested:
            break
    return events
