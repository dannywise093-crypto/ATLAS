import io
import os
import secrets
from threading import Lock
from typing import Literal
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pocket_tts import TTSModel
from scipy.io import wavfile
from starlette.concurrency import run_in_threadpool

MODEL = None
VOICE_STATE = None
MODEL_LOCK = Lock()
API_TOKEN = os.environ.get("ATLAS_VOICE_CLONE_TOKEN", "")
REFERENCE_AUDIO = Path(os.environ.get("ATLAS_REFERENCE_AUDIO_PATH", "/data/atlas-reference.wav"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    global MODEL, VOICE_STATE
    if not API_TOKEN:
        raise RuntimeError("ATLAS_VOICE_CLONE_TOKEN must be configured.")
    if not REFERENCE_AUDIO.is_file():
        raise RuntimeError(
            f"Reference voice file not found at {REFERENCE_AUDIO}. "
            "Install the approved reference recording before starting the service."
        )
    MODEL = TTSModel.load_model(language="english", quantize=True)
    VOICE_STATE = MODEL.get_state_for_audio_prompt(str(REFERENCE_AUDIO))
    yield
    MODEL = None
    VOICE_STATE = None


app = FastAPI(title="ATLAS Reference Voice Service", version="0.1.0", lifespan=lifespan)


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=4000)
    voice: str = "file://atlas-reference"
    language_id: str = "en"
    response_format: Literal["wav"] = "wav"


def require_auth(authorization: str | None):
    if not API_TOKEN or not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    supplied = authorization[7:]
    if not secrets.compare_digest(supplied, API_TOKEN):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
async def health():
    return {
        "service": "ATLAS Pocket TTS reference voice",
        "status": "ready" if MODEL is not None and VOICE_STATE is not None else "starting",
        "backend": "Kyutai Pocket TTS CPU",
        "reference_voice_loaded": VOICE_STATE is not None,
    }


@app.post("/v1/audio/speech")
async def speech(payload: SpeechRequest, authorization: str | None = Header(default=None)):
    require_auth(authorization)
    if MODEL is None or VOICE_STATE is None:
        raise HTTPException(status_code=503, detail="Reference voice is not ready.")
    if payload.voice != "file://atlas-reference":
        raise HTTPException(status_code=400, detail="Unknown ATLAS voice.")
    if payload.language_id != "en":
        raise HTTPException(status_code=400, detail="Only English is configured.")
    def generate():
        # Pocket TTS documents generate_audio() as non-thread-safe. Serialize
        # inference because this service deliberately keeps one model in memory.
        with MODEL_LOCK:
            audio = MODEL.generate_audio(VOICE_STATE, payload.input)
        samples = audio.detach().cpu().numpy()
        samples = np.asarray(samples, dtype=np.float32).reshape(-1)
        samples = np.nan_to_num(samples, copy=False, nan=0.0, posinf=1.0, neginf=-1.0)
        samples = np.clip(samples, -1.0, 1.0)
        pcm16 = (samples * 32767.0).astype(np.int16)
        output = io.BytesIO()
        wavfile.write(output, MODEL.sample_rate, pcm16)
        return output.getvalue()

    audio_bytes = await run_in_threadpool(generate)
    # Pocket TTS produces WAV natively. The browser audio element supports WAV;
    # avoid adding an ffmpeg dependency just to transcode it to MP3.
    return Response(
        content=audio_bytes,
        media_type="audio/wav",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-ATLAS-Voice": "reference-clone",
        },
    )
