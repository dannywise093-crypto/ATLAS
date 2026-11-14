# ATLAS AI — General Language Model Foundation

ATLAS is a mobile-friendly React + Capacitor AI workspace. The project is moving
from a rule-based demo toward a general-purpose assistant powered by an open-weight
foundation model through a secure, model-agnostic gateway.

## Current capabilities

- Responsive React interface and Android Capacitor wrapper.
- Local project notes and memory commands stored in browser localStorage.
- General chat client connected to the ATLAS server gateway.
- FastAPI gateway for OpenAI-compatible model inference services.
- Server-side model credentials; no provider key is exposed in frontend code.
- Experimental ATLAS-1 architecture and training research code remain separate.

## Model service setup

The repository does not bundle model weights or host an inference server. Configure
a compatible inference service (for example, llama.cpp server or vLLM), then configure
the ATLAS gateway:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
cp server/.env.example server/.env
uvicorn server.main:app --host 0.0.0.0 --port 8000
```

Set `ATLAS_UPSTREAM_BASE_URL` and `ATLAS_MODEL_ID` to match your inference service.
If authentication is required, set `ATLAS_UPSTREAM_API_KEY` only in the backend's
private environment. Never put secrets in frontend variables or commit them.

For a frontend hosted separately from the gateway, set `VITE_ATLAS_API_URL` to the
gateway's public base URL and add the frontend origin to `ATLAS_ALLOWED_ORIGINS`.

## Run the frontend

Requires Node.js 18 or newer.

```bash
npm install
npm run dev
npm test
npm run build
```

## Android test APK

A Capacitor Android wrapper and GitHub Actions workflow are included. Open
**Actions → Build ATLAS Android test APK → Run workflow**. Download the
`atlas-ai-debug-apk` artifact when the workflow completes. This is a debug/test APK,
not a Play Store release.

## Architecture and roadmap

See [docs/GENERAL_LANGUAGE_MODEL_ROADMAP.md](docs/GENERAL_LANGUAGE_MODEL_ROADMAP.md)
for the chosen model strategy, deployment configuration, and milestones.

## Safety

The Robotics screen is informational only. Do not connect this model directly to
motors or actuators. Any future physical control system must use an independent
safety controller, emergency stop, bounded movement, watchdogs, and supervised tests.
