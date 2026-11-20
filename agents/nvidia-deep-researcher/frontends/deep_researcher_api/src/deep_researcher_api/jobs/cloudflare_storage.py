"""HTTP client for the NEXORA Cloudflare Durable Object storage gateway.

This module is deliberately a transport primitive, not a drop-in NAT JobStore.
It exposes the durable record/event contract so higher-level adapters can be
built and tested without pretending SQLAlchemy's relational interfaces exist.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen


class CloudflareStorageError(RuntimeError):
    """The Cloudflare storage gateway returned an unsuccessful response."""


class CloudflareStorageConflict(CloudflareStorageError):
    """A record revision did not match the expected revision."""


class CloudflareStorageNotFound(CloudflareStorageError):
    """A requested durable record does not exist."""


class CloudflareStorageClient:
    """Tenant-scoped client for the private research Worker storage routes."""

    def __init__(
        self,
        *,
        tenant: str,
        base_url: str | None = None,
        token: str | None = None,
        timeout: float = 15.0,
    ) -> None:
        self.tenant = self._segment(tenant, "tenant")
        self.base_url = (base_url or os.environ.get("NEXORA_RESEARCH_STORAGE_URL", "")).rstrip("/")
        self.token = token or os.environ.get("NEXORA_RESEARCH_API_TOKEN", "")
        self.timeout = timeout
        if not self.base_url:
            raise ValueError("NEXORA_RESEARCH_STORAGE_URL is required")
        parsed = urlsplit(self.base_url)
        local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if parsed.scheme != "https" and not local_http:
            raise ValueError("Research storage URL must use HTTPS (HTTP is allowed only for localhost tests)")
        if not parsed.hostname or parsed.path not in {"", "/"} or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Research storage URL must be an origin without credentials, query, or fragment")
        if len(self.token) < 32:
            raise ValueError("NEXORA_RESEARCH_API_TOKEN must contain at least 32 characters")

    @staticmethod
    def _segment(value: str, label: str) -> str:
        if not isinstance(value, str) or not value or value in {".", ".."}:
            raise ValueError(f"Invalid {label}")
        if len(value) > 128 or not all(c.isascii() and (c.isalnum() or c in "._-") for c in value):
            raise ValueError(f"Invalid {label}")
        if not value[0].isalnum():
            raise ValueError(f"Invalid {label}")
        return value

    def _url(self, suffix: str) -> str:
        return (
            f"{self.base_url}/internal/storage/v1/tenants/"
            f"{quote(self.tenant, safe='')}/{suffix}"
        )

    def _request(self, method: str, url: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = None if payload is None else json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
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
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read(1024 * 1024 + 1)
                if len(raw) > 1024 * 1024:
                    raise CloudflareStorageError("Storage response exceeded the 1 MiB client limit")
                return json.loads(raw.decode("utf-8")) if raw else {}
        except HTTPError as exc:
            if exc.code == 409:
                raise CloudflareStorageConflict("Storage revision conflict") from exc
            if exc.code == 404:
                raise CloudflareStorageNotFound("Storage record not found") from exc
            raise CloudflareStorageError(f"Storage gateway returned HTTP {exc.code}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise CloudflareStorageError("Storage gateway request failed") from exc
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CloudflareStorageError("Storage gateway returned invalid JSON") from exc

    def get_record(self, namespace: str, key: str) -> dict[str, Any] | None:
        namespace = self._segment(namespace, "namespace")
        key = self._segment(key, "record key")
        try:
            return self._request("GET", self._url(f"records/{quote(namespace, safe='')}/{quote(key, safe='')}"))
        except CloudflareStorageNotFound:
            return None

    def put_record(
        self,
        namespace: str,
        key: str,
        value: Any,
        *,
        expected_revision: int | None = None,
    ) -> dict[str, Any]:
        namespace = self._segment(namespace, "namespace")
        key = self._segment(key, "record key")
        payload: dict[str, Any] = {"value": value}
        if expected_revision is not None:
            if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
                raise ValueError("expected_revision must be a non-negative integer")
            payload["expectedRevision"] = expected_revision
        return self._request(
            "PUT",
            self._url(f"records/{quote(namespace, safe='')}/{quote(key, safe='')}"),
            payload,
        )

    def delete_record(self, namespace: str, key: str) -> dict[str, Any]:
        namespace = self._segment(namespace, "namespace")
        key = self._segment(key, "record key")
        return self._request("DELETE", self._url(f"records/{quote(namespace, safe='')}/{quote(key, safe='')}"))

    def append_event(self, job_id: str, event: dict[str, Any]) -> dict[str, Any]:
        job_id = self._segment(job_id, "job ID")
        if not isinstance(event, dict):
            raise ValueError("event must be a JSON object")
        return self._request("POST", self._url(f"events/{quote(job_id, safe='')}"), {"event": event})

    def get_events(self, job_id: str, *, after: int = 0, limit: int = 100) -> dict[str, Any]:
        job_id = self._segment(job_id, "job ID")
        if isinstance(after, bool) or not isinstance(after, int) or after < 0:
            raise ValueError("after must be a non-negative integer")
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
            raise ValueError("limit must be a positive integer")
        return self._request(
            "GET",
            self._url(f"events/{quote(job_id, safe='')}?after={after}&limit={min(limit, 200)}"),
        )

    async def aget_record(self, namespace: str, key: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self.get_record, namespace, key)

    async def aput_record(
        self, namespace: str, key: str, value: Any, *, expected_revision: int | None = None
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self.put_record, namespace, key, value, expected_revision=expected_revision
        )

    async def adelete_record(self, namespace: str, key: str) -> dict[str, Any]:
        return await asyncio.to_thread(self.delete_record, namespace, key)

    async def aappend_event(self, job_id: str, event: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.to_thread(self.append_event, job_id, event)

    async def aget_events(self, job_id: str, *, after: int = 0, limit: int = 100) -> dict[str, Any]:
        return await asyncio.to_thread(self.get_events, job_id, after=after, limit=limit)
