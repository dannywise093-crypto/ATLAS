from __future__ import annotations

import asyncio

from deep_researcher_api.jobs.cloudflare_event_store import CloudflareEventStore


class _MemoryStorage:
    def __init__(self):
        self.events = {}

    def append_event(self, job_id, event):
        rows = self.events.setdefault(job_id, [])
        sequence = len(rows) + 1
        rows.append({"sequence": sequence, "event": event})
        return {"sequence": sequence}

    def get_events(self, job_id, *, after=0, limit=100):
        rows = [row for row in self.events.get(job_id, []) if row["sequence"] > after][:limit]
        return {"events": rows, "nextAfter": rows[-1]["sequence"] if rows else after}

    async def aappend_event(self, job_id, event):
        return self.append_event(job_id, event)

    async def aget_events(self, job_id, *, after=0, limit=100):
        return self.get_events(job_id, after=after, limit=limit)


def test_store_and_batch_append_ordered_events():
    storage = _MemoryStorage()
    store = CloudflareEventStore(storage, "job-1")
    store.store({"type": "progress", "message": "started"})
    store.store_batch([
        {"type": "progress", "message": "searching"},
        {"type": "complete", "message": "finished"},
    ])
    events = CloudflareEventStore.get_events(storage, "job-1")
    assert [event["_id"] for event in events] == [1, 2, 3]
    assert [event["type"] for event in events] == ["progress", "progress", "complete"]


def test_async_append_and_cursor_reads_preserve_event_ids():
    async def run():
        storage = _MemoryStorage()
        store = CloudflareEventStore(storage, "job-2")
        assert await store.astore({"type": "progress", "step": 1}) == 1
        assert await store.astore({"type": "progress", "step": 2}) == 2
        page = await store.aget_events(after_id=1, limit=1)
        assert page == [{"type": "progress", "step": 2, "_id": 2}]
    asyncio.run(run())


def test_event_store_rejects_invalid_pagination():
    store = CloudflareEventStore(_MemoryStorage(), "job-3")
    try:
        asyncio.run(store.aget_events(after_id=-1))
    except ValueError as exc:
        assert "after_id" in str(exc)
    else:
        raise AssertionError("Expected invalid cursor to fail")
