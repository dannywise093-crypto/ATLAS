# ATLAS AI — General Language Model Foundation

ATLAS is a mobile-friendly React + Capacitor AI workspace. It uses an open-weight
foundation model through a server-side gateway; this repository does not claim to
train or bundle a general-purpose model.

## Current capabilities

- Responsive React interface and Android Capacitor wrapper.
- Local project notes and memory commands stored in browser localStorage.
- Same-origin Vercel serverless proxy for browser chat and health requests.
- FastAPI gateway that forwards requests to an OpenAI-compatible inference service.
- Server-side-only gateway and model credentials.
- Input validation and best-effort per-instance proxy rate limiting.
- Explicit errors when the backend or model is not configured.

## Deploy the backend on Render

1. In Render, create a **Blueprint** from this repository and use the included
   `render.yaml`. It creates `atlas-model-gateway` and generates
   `ATLAS_GATEWAY_TOKEN`.
2. In the Render service environment, set:
   - `ATLAS_UPSTREAM_BASE_URL`: the OpenAI-compatible API base URL, including
     `/v1` (for example, `https://your-inference-host.example/v1`).
   - `ATLAS_MODEL_ID`: the exact model identifier exposed by that service.
   - `ATLAS_UPSTREAM_API_KEY`: only if the inference provider requires it.
3. Wait for the Render service to become healthy. The health endpoint is
   `/api/health`; it is public so Render can run its health check. Chat requests require the gateway bearer token.

The repository does not create a model-hosting account, purchase inference, or
supply model weights. A compatible inference endpoint and its credentials must
be provided before chat can work.

## Connect Vercel to Render

In **both** Vercel projects that serve ATLAS, add these server-side environment
variables to Production and Preview:

- `ATLAS_GATEWAY_URL`: the Render service base URL, without a trailing slash.
- `ATLAS_GATEWAY_TOKEN`: copy the generated secret from the Render service.

Do not prefix either variable with `VITE_`. Do not expose the token to browser code.
Redeploy both Vercel projects after setting the variables. The frontend calls
same-origin `/api/chat` and `/api/health` routes; those Vercel functions securely
forward requests to Render.

## Local development

Install dependencies and run the frontend:

```bash
npm ci
npm run dev
npm test
npm run build
```

For an end-to-end local deployment test, run the FastAPI service using
`server/.env` (copied from `server/.env.example`) and use Vercel's local
development server so the `api/` serverless proxy routes are available.

## Android test APK

The GitHub Actions workflow builds a debug APK and uploads it as
`atlas-ai-debug-apk`. Download it from the completed workflow run. It is a
debug/test APK, not a Play Store release. Configure the Vercel environment
variables and redeploy before installing the APK if it should use the live AI.

## Security notes

The Vercel proxy keeps the Render gateway token out of the browser. The proxy's
in-memory rate limit is only a best-effort guard because serverless instances do
not share state. Before public launch, configure durable Vercel Firewall or
equivalent edge rate limiting, usage quotas, monitoring, and billing alerts.
Keep all provider keys server-side. Never commit `server/.env`.

## Architecture and roadmap

See [docs/GENERAL_LANGUAGE_MODEL_ROADMAP.md](docs/GENERAL_LANGUAGE_MODEL_ROADMAP.md).
The current integration does not train ATLAS model weights or make the experimental
ATLAS-1 checkpoint a general language model.
