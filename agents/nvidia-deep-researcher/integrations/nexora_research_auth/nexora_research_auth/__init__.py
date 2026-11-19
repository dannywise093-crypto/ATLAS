"""NEXORA's private service-token validator for NVIDIA Deep Researcher.

The token is only used between Cloudflare Pages Functions and the research
backend. It must never be exposed to browser code or returned by an API.
"""

from __future__ import annotations

import hmac
import os
from typing import Any

from deep_researcher_api.auth.base import TokenValidator


class NexoraServiceTokenValidator(TokenValidator):
    """Validate the single server-side NEXORA-to-researcher bearer credential."""

    def __init__(self, expected_token: str) -> None:
        if len(expected_token) < 32:
            raise ValueError("NEXORA_RESEARCH_API_TOKEN must contain at least 32 characters")
        self._expected_token = expected_token

    def can_handle(self, token: str) -> bool:
        return isinstance(token, str) and bool(token)

    async def validate(self, token: str) -> tuple[dict[str, Any] | None, str | None]:
        if not hmac.compare_digest(token, self._expected_token):
            return None, "token_invalid"
        return (
            {
                "type": "nexora_service",
                "sub": "nexora-pages-gateway",
                "email": None,
                "name": "NEXORA Pages Gateway",
                "token": token,
                "skip_clarifier": True,
            },
            None,
        )


def get_validators() -> list[NexoraServiceTokenValidator]:
    """Entry-point factory loaded by Deep Researcher's API plugin."""
    token = os.environ.get("NEXORA_RESEARCH_API_TOKEN", "")
    if not token:
        if os.environ.get("REQUIRE_AUTH", "false").lower() == "true":
            raise RuntimeError(
                "REQUIRE_AUTH=true but NEXORA_RESEARCH_API_TOKEN is not configured"
            )
        return []
    return [NexoraServiceTokenValidator(token)]
