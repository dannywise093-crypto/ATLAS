"""ATLAS model gateway.

Connects the mobile/web app to an OpenAI-compatible inference server.
Provider credentials stay on this server and are never exposed to the browser.
"""
from __future__ import annotations

import os
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

APP_NAME = "ATLAS Model Gateway"
UPSTREAM_BASE_URL = os.getenv("ATLAS_UPSTREAM_BASE_URL", "http://127.0.0.1:1234/v1").rstrip("/")
UPSTREAM_MODEL = os.getenv("ATLAS_MODEL_ID", "local-model")
UPSTREAM_API_KEY = os.getenv("ATLAS_UPSTREAM_API_KEY", "")
UPSTREAM_TIMEOUT = float(os.getenv("ATLAS_UPSTREAM_TIMEOUT_SECONDS", "90"))
MAX_MESSAGES = 24
MAX_MESSAGE_CHARS = 12000

SYSTEM_PROMPT = """You are ATLAS, a helpful general-purpose AI assistant.
Be accurate, clear, and honest about uncertainty. Explain your reasoning at an
appropriate level, ask for missing details when needed, and do not claim to have
used tools, accessed files, or verified facts unless that actually happened.
You are a language model: do not claim consciousness or guaranteed correctness.
For physical-world or high-impact actions, prioritize safety and human oversight."""

app = FastAPI(title=APP_NAME, version="0.1.0")

origins = [value.strip() for value in os.getenv(
    "ATLAS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",") if value.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Accept"],
)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)


@app.get("/api/health")
async def health():
    return {
        "service": APP_NAME,
        "status": "ready",
        "provider_configured": bool(UPSTREAM_BASE_URL and UPSTREAM_MODEL),
        "model": UPSTREAM_MODEL,
        "upstream": UPSTREAM_BASE_URL,
    }


@app.post("/api/chat")
async def chat(request: ChatRequest):
    if not UPSTREAM_BASE_URL or not UPSTREAM_MODEL:
        raise HTTPException(status_code=503, detail="ATLAS model endpoint is not configured on the server.")

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
        # Do not relay upstream response bodies; they may contain internal details.
        raise HTTPException(status_code=502, detail=f"The model server returned HTTP {upstream.status_code}.")

    try:
        data = upstream.json()
        answer = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="The model server returned an unsupported response format.") from exc

    if not isinstance(answer, str) or not answer.strip():
        raise HTTPException(status_code=502, detail="The configured model returned an empty response.")

    return {"answer": answer.strip(), "model": data.get("model", UPSTREAM_MODEL)}
