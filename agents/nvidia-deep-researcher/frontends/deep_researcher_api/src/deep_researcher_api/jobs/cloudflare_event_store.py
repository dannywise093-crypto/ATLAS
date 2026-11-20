"""Cloudflare Durable Object event persistence adapter prototype.

It preserves the event payload and the monotonically increasing per-job cursor
used by SSE clients. It is not wired into the existing FastAPI routes yet.
"""

from __future__ import annotations

import asyncio
import copy
import logging
from typing import Any

from deep_researcher_agent.common.logging_utils import log_content_metadata

from .cloudflare_storage import CloudflareStorageClient
from .crypto import ContentEncryptionError

logger = logging.getLogger(__name__)


class CloudflareEventStore:
    """Append/read event adapter over tenant-scoped Cloudflare storage."""

    def __init__(
        self,
        storage: CloudflareStorageClient,
        job_id: str,
        content_cipher: Any | None = None,
    ) -> None:
        if not isinstance(job_id, str) or not job_id:
            raise ValueError("job_id is required")
        self.storage = storage
        self.job_id = job_id
        self._content_cipher = content_cipher
        self._fail_closed = bool(content_cipher is not None and content_cipher.manager.config.encrypted)

    def _prepare_event_for_storage(self, event: dict) -> dict:
        if self._content_cipher is None or event.get("type") != "artifact.update":
            return event
        data = event.get("data")
        if not isinstance(data, dict) or data.get("type") not in {"output", "file"} or "content" not in data:
            return event
        from .crypto import encrypt_event_field, is_encrypted_event_field

        if is_encrypted_event_field(data["content"]):
            return event
        encrypted = copy.deepcopy(event)
        encrypted["data"]["content"] = encrypt_event_field(
            self.job_id, "artifact.update.data.content", encrypted["data"].get("content"), self._content_cipher
        )
        return encrypted

    def _prepare_event_for_return(self, event: dict) -> dict:
        data = event.get("data")
        if not isinstance(data, dict) or data.get("type") not in {"output", "file"} or "content" not in data:
            return event
        from .crypto import decrypt_event_field, is_encrypted_event_field

        if not is_encrypted_event_field(data["content"]):
            return event
        decrypted = copy.deepcopy(event)
        decrypted["data"]["content"] = decrypt_event_field(
            self.job_id, "artifact.update.data.content", decrypted["data"].get("content")
        )
        return decrypted

    def store(self, event: dict) -> None:
        event_type = event.get("type", "unknown")
        try:
            stored = self._prepare_event_for_storage(event)
            self.storage.append_event(self.job_id, stored)
        except Exception as exc:
            logger.warning(
                "Failed to store event %s for job %s (error_type=%s error_%s)",
                event_type,
                self.job_id,
                type(exc).__name__,
                log_content_metadata(exc),
            )
            if self._fail_closed:
                raise

    def store_batch(self, events: list[dict]) -> None:
        # The current DO API guarantees ordering per append, not atomic batch
        # commits. Each event is therefore appended independently.
        for event in events:
            self.store(event)

    async def astore(self, event: dict) -> int | None:
        stored = self._prepare_event_for_storage(event)
        result = await self.storage.aappend_event(self.job_id, stored)
        return result.get("sequence")

    async def aget_events(self, after_id: int = 0, limit: int = 100) -> list[dict]:
        if isinstance(after_id, bool) or not isinstance(after_id, int) or after_id < 0:
            raise ValueError("after_id must be a non-negative integer")
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
            raise ValueError("limit must be a positive integer")
        page = await self.storage.aget_events(self.job_id, after=after_id, limit=min(limit, 200))
        events = []
        for item in page.get("events", []):
            event = self._prepare_event_for_return(item["event"])
            event["_id"] = item["sequence"]
            events.append(event)
        return events

    @staticmethod
    async def get_events_async(
        storage: CloudflareStorageClient,
        job_id: str,
        after_id: int = 0,
        limit: int = 100,
        content_cipher: Any | None = None,
    ) -> list[dict]:
        adapter = CloudflareEventStore(storage, job_id, content_cipher)
        return await adapter.aget_events(after_id=after_id, limit=limit)

    @staticmethod
    def get_events(
        storage: CloudflareStorageClient,
        job_id: str,
        after_id: int = 0,
        limit: int = 100,
        content_cipher: Any | None = None,
    ) -> list[dict]:
        return asyncio.run(
            CloudflareEventStore.get_events_async(storage, job_id, after_id, limit, content_cipher)
        )
