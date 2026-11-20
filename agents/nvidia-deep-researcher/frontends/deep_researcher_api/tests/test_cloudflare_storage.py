from __future__ import annotations

import io
import json
from unittest.mock import patch

import pytest

from deep_researcher_api.jobs.cloudflare_storage import (
    CloudflareStorageClient,
    CloudflareStorageConflict,
)


class _Response:
    def __init__(self, value: dict):
        self.body = json.dumps(value).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self, _limit=-1):
        return self.body


def _client() -> CloudflareStorageClient:
    return CloudflareStorageClient(
        tenant="tenant-a",
        base_url="https://research.example.workers.dev",
        token="x" * 40,
    )


def test_put_record_uses_tenant_scoped_route_and_revision_guard():
    with patch(
        "deep_researcher_api.jobs.cloudflare_storage.urlopen",
        return_value=_Response({"ok": True, "revision": 3}),
    ) as open_url:
        result = _client().put_record("jobs", "job-1", {"status": "running"}, expected_revision=2)

    request = open_url.call_args.args[0]
    assert request.full_url.endswith("/internal/storage/v1/tenants/tenant-a/records/jobs/job-1")
    assert request.get_method() == "PUT"
    assert request.get_header("Authorization") == "Bearer " + "x" * 40
    assert json.loads(request.data) == {"value": {"status": "running"}, "expectedRevision": 2}
    assert result["revision"] == 3


def test_event_append_and_pagination_use_job_scoped_routes():
    with patch(
        "deep_researcher_api.jobs.cloudflare_storage.urlopen",
        side_effect=[_Response({"sequence": 1}), _Response({"events": [], "nextAfter": 1})],
    ) as open_url:
        client = _client()
        appended = client.append_event("job-1", {"type": "progress"})
        page = client.get_events("job-1", after=1, limit=500)

    assert appended["sequence"] == 1
    assert page["nextAfter"] == 1
    assert open_url.call_args_list[1].args[0].full_url.endswith("/events/job-1?after=1&limit=200")


def test_missing_record_returns_none():
    from urllib.error import HTTPError

    error = HTTPError("https://example.test", 404, "missing", {}, io.BytesIO(b"{}"))
    with patch("deep_researcher_api.jobs.cloudflare_storage.urlopen", side_effect=error):
        assert _client().get_record("jobs", "missing") is None


def test_revision_conflict_is_not_silently_retried():
    from urllib.error import HTTPError

    error = HTTPError("https://example.test", 409, "conflict", {}, io.BytesIO(b'{"error":"conflict"}'))
    with patch("deep_researcher_api.jobs.cloudflare_storage.urlopen", side_effect=error):
        with pytest.raises(CloudflareStorageConflict):
            _client().put_record("jobs", "job-1", {"status": "running"}, expected_revision=1)


@pytest.mark.parametrize("bad", ["../tenant", "a/b", "has space", ""])
def test_identifiers_reject_path_traversal_and_invalid_values(bad):
    with pytest.raises(ValueError):
        CloudflareStorageClient(
            tenant=bad,
            base_url="https://research.example.workers.dev",
            token="x" * 40,
        )


def test_client_rejects_insecure_remote_endpoint_and_short_token():
    with pytest.raises(ValueError):
        CloudflareStorageClient(tenant="tenant-a", base_url="http://research.example.com", token="x" * 40)
    with pytest.raises(ValueError):
        CloudflareStorageClient(tenant="tenant-a", base_url="https://research.example.com/unexpected-path", token="x" * 40)
    with pytest.raises(ValueError):
        CloudflareStorageClient(tenant="tenant-a", base_url="https://research.example.com", token="short")
