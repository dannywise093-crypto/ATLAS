# NEXORA × NVIDIA Deep Researcher deployment

This document connects the vendored NVIDIA Deep Researcher 2.2.0 backend to
NEXORA without moving Python dependencies into the React application or
Cloudflare Worker.

## Architecture

```text
NEXORA browser
  -> same-origin /api/research/* (Cloudflare Pages Function)
  -> authenticated server-to-server request
  -> NVIDIA Deep Researcher API (separate Python service)
  -> NeMo Agent Toolkit + research workflows + search tools
  -> persistent async job store and cited report
```

The browser never receives `NEXORA_RESEARCH_API_TOKEN`. The backend uses the
NEXORA-owned `nexora-research-auth` entry-point package to validate that token.
The initial integration uses one service principal (`nexora-pages-gateway`);
it is not per-account identity because the current NEXORA workspace has no
server-authenticated user accounts. Job IDs are random and the API is not
intended to be exposed directly to browsers.

## Backend container

Build the existing NVIDIA Dockerfile with this directory as the build context:

- Context: `agents/nvidia-deep-researcher`
- Dockerfile: `deploy/Dockerfile`
- Target: `release`
- Port: `8000`

The Dockerfile installs the small NEXORA auth adapter in addition to the
upstream NVIDIA packages. Keep the NVIDIA source tree and its license files.

## Required backend environment

Set these as private environment variables in the backend hosting service:

- `CONFIG_FILE=/app/configs/config_web_frag.yml`
- `HOST=0.0.0.0`
- `PORT=8000`
- `APP_ENV=production`
- `REQUIRE_AUTH=true`
- `DEEP_RESEARCHER_EXTERNAL_HOSTNAMES`: the backend service hostname only (for example, `your-service.onrender.com`, without scheme or port); this makes the API enforce its external path allowlist and token validation.
- `DEEP_RESEARCHER_ENABLE_DEBUG=false`
- `NEXORA_RESEARCH_API_TOKEN`: generate a unique random value of at least 32 characters.
- `NVIDIA_API_KEY`: NVIDIA API Catalog credential for the models in the selected workflow.
- `TAVILY_API_KEY`: web-search provider credential (the default profile uses Tavily).
- `NAT_JOB_STORE_DB_URL`: durable PostgreSQL URL for production jobs and event storage.

Do not paste credentials into chat or commit them. Generate the token in the
hosting provider's secret manager. Set the exact same token as a Cloudflare
Pages secret named `NEXORA_RESEARCH_API_TOKEN`.

The container's startup script and API health endpoints should be checked after
deployment. Do not expose port 8000 publicly without HTTPS and the auth
validator enabled. Configure the service's health check against its documented
health/readiness endpoint only after confirming the selected config registers
that endpoint.

## Cloudflare Pages environment

Configure these server-side Pages variables/secrets:

- `DEEP_RESEARCHER_URL`: HTTPS origin of the deployed backend, without a trailing slash.
- `NEXORA_RESEARCH_API_TOKEN`: the same secret configured on the backend.

The Pages Function exposes only the approved async research routes under
`/api/research/`, applies request validation and per-IP limits, and streams
server-sent events without buffering the report stream.

## Current integration boundary

The API proxy and backend authentication adapter are the first integration
slice. The NEXORA interface still needs a Research Center that submits jobs,
shows progress from SSE, recovers a job after refresh, and renders the final
report with source citations. Backend deployment and live end-to-end research
are not complete until the hosting secrets, database, model credential, and
search credential are configured and the service passes a real test query.
