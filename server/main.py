"""ATLAS model gateway.

This legacy Python gateway is for local development only. Production ATLAS web
requests use Cloudflare Pages Functions and the Cloudflare Worker. If this local
gateway is enabled, it accepts requests only from a trusted proxy when
ATLAS_GATEWAY_TOKEN is configured. Provider credentials never reach the browser.
"""
from __future__ import annotations

import hmac
import os
from typing import Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

APP_NAME = "ATLAS Model Gateway"
UPSTREAM_BASE_URL = os.getenv("ATLAS_UPSTREAM_BASE_URL", "").strip().rstrip("/")
UPSTREAM_MODEL = os.getenv("ATLAS_MODEL_ID", "").strip()
UPSTREAM_API_KEY = os.getenv("ATLAS_UPSTREAM_API_KEY", "")
GATEWAY_TOKEN = os.getenv("ATLAS_GATEWAY_TOKEN", "")
UPSTREAM_TIMEOUT = max(5.0, min(float(os.getenv("ATLAS_UPSTREAM_TIMEOUT_SECONDS", "45")), 120.0))
MAX_MESSAGES = 24
MAX_MESSAGE_CHARS = 12000

SYSTEM_PROMPT = """You are ATLAS, a helpful general-purpose AI assistant.
Be accurate, clear, and honest about uncertainty. Explain your reasoning at an
appropriate level, ask for missing details when needed, and do not claim to have
used tools, accessed files, or verified facts unless that actually happened.
You are a language model: do not claim consciousness or guaranteed correctness.
For physical-world or high-impact actions, prioritize safety and human oversight."""

app = FastAPI(title=APP_NAME, version="0.2.0")

origins = [value.strip() for value in os.getenv(
    "ATLAS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",") if value.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Accept", "Authorization"],
)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)


def require_gateway_access(authorization: str | None = Header(default=None)) -> None:
    # An empty token is intended only for local development. Render deployment
    # uses render.yaml's generated secret and therefore requires bearer auth.
    if not GATEWAY_TOKEN:
        return
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not supplied or not hmac.compare_digest(supplied, GATEWAY_TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized gateway request.")


@app.get("/api/health")
async def health():
    configured = bool(UPSTREAM_BASE_URL and UPSTREAM_MODEL)
    return {
        "service": APP_NAME,
        "status": "configured" if configured else "not_configured",
        "provider_configured": configured,
        "gateway_auth_enabled": bool(GATEWAY_TOKEN),
        "model": UPSTREAM_MODEL or None,
    }


@app.post("/api/chat", dependencies=[Depends(require_gateway_access)])
async def chat(request: ChatRequest):
    if not UPSTREAM_BASE_URL or not UPSTREAM_MODEL:
        raise HTTPException(
            status_code=503,
            detail="ATLAS model endpoint is not configured on the server.",
        )

    payload = {
        "model": UPSTREAM_MODEL,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}]
        + [message.model_dump() for message in request.messages],
        "temperature": 0.7,
        "max_tokens": 1200,
        "stream": False,
    }
    headers = {"Content-Type": "application/json"}
    if UPSTREAM_API_KEY:
        headers["Authorization"] = f"Bearer {UPSTREAM_API_KEY}"

    try:
        async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
            upstream = await client.post(
                f"{UPSTREAM_BASE_URL}/chat/completions",
                json=payload,
                headers=headers,
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="The model server took too long to respond.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="ATLAS could not connect to its configured model server.") from exc

    if upstream.is_error:
        raise HTTPException(status_code=502, detail=f"The model server returned HTTP {upstream.status_code}.")

    try:
        data = upstream.json()
        answer = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="The model server returned an unsupported response format.") from exc

    if not isinstance(answer, str) or not answer.strip():
        raise HTTPException(status_code=502, detail="The configured model returned an empty response.")

    return {"answer": answer.strip(), "model": data.get("model") or UPSTREAM_MODEL}
