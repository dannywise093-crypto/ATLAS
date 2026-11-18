# SPDX-License-Identifier: Apache-2.0
"""Private ATLAS-to-Deep-Researcher service authentication.

The credential is configured only in the backend secret store and ATLAS Worker.
It is never embedded in the browser bundle or repository.
"""
from __future__ import annotations

import hmac
import os
from typing import Any

from deep_researcher_api.auth.base import TokenValidator


class AtlasGatewayTokenValidator(TokenValidator):
    """Validate the opaque shared credential used by the trusted ATLAS gateway."""

    def __init__(self) -> None:
        self._expected = os.environ.get("ATLAS_INTERNAL_TOKEN", "")

    def can_handle(self, token: str) -> bool:
        return token.startswith("atlas_") and len(token) >= 40

    async def validate(self, token: str) -> tuple[dict[str, Any] | None, str | None]:
        if not self._expected:
            return None, "token_invalid"
        if not hmac.compare_digest(token, self._expected):
            return None, "token_invalid"
        return (
            {
                "type": "atlas_service",
                "sub": "atlas-gateway",
                "email": None,
                "name": "ATLAS Gateway",
                "token": token,
                "skip_clarifier": True,
            },
            None,
        )


def get_validators() -> list[TokenValidator]:
    """Entry-point factory loaded by the upstream Deep Researcher API."""
    return [AtlasGatewayTokenValidator()]
