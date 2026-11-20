# NEXORA × NVIDIA Deep Researcher — Cloudflare-only deployment

This document is the NEXORA deployment contract for the vendored NVIDIA Deep
Researcher source. Preserve the upstream NVIDIA source, licenses, workflows,
and package boundaries. Do not move the Python dependencies into the React app
or an ordinary Workers JavaScript runtime.

## Required architecture

```text
NEXORA browser
  -> Cloudflare Pages Function: /api/research/*
  -> private Cloudflare Worker service binding
  -> Cloudflare Durable Object Container
  -> NVIDIA Deep Researcher Python API (port 8000)
  -> NeMo Agent Toolkit + Nemotron + provider tools
```

The browser must never receive provider API keys or
`NEXORA_RESEARCH_API_TOKEN`. The Pages Function authenticates to the research
Worker; the Durable Object passes only the required secrets to the container
when it starts. The container must not expose an unauthenticated public API.

Cloudflare Containers require a Workers Paid plan and a Linux/amd64 image.
Build and deployment must run in an environment with Docker available (for
example, a secured GitHub Actions runner); the user's Android phone does not
need to run the Docker build itself.

## NEXORA provider profile

Use:

`CONFIG_FILE=/app/configs/config_nexora_all_providers.yml`

This profile enables:
- NVIDIA Nemotron inference using `NVIDIA_API_KEY`.
- Tavily web search using `TAVILY_API_KEY`.
- Exa web search using `EXA_API_KEY`.
- Nimble web search using `NIMBLE_API_KEY`.
- You.com web search, research, contents, and finance research using `YDC_API_KEY`.
- Academic paper search through Serper using `SERPER_API_KEY`.

These are separate tools made available to the research agents. This is
multi-provider tool availability, not a guarantee that a failed provider call
is transparently retried against every other provider. Agent selection and
provider-level retry behavior remain governed by the upstream tool
implementations.

The You.com source package must be installed in the backend image; the
NEXORA Dockerfile includes it explicitly. Keep the provider API keys in
Cloudflare Worker secrets and pass them into the Container process at startup.
Secrets configured on `atlas-model-gateway` do not automatically become
available to a separate research Worker or Container. Add the same named
secrets to the research Worker (or use Cloudflare Secrets Store) and map them
to the container's startup environment.

## Required secrets and runtime settings

Provider secrets:
- `NVIDIA_API_KEY`
- `TAVILY_API_KEY`
- `EXA_API_KEY`
- `NIMBLE_API_KEY`
- `YDC_API_KEY`
- `SERPER_API_KEY`

NEXORA service authentication:
- `NEXORA_RESEARCH_API_TOKEN`: generate a unique random value of at least 32
  characters. Configure it as a secret on both the Pages Function and research
  Worker/container. Never expose it to browser code.

Non-secret runtime configuration:
- `CONFIG_FILE=/app/configs/config_nexora_all_providers.yml`
- `HOST=0.0.0.0`
- `PORT=8000`
- `APP_ENV=production`
- `REQUIRE_AUTH=true`
- `DEEP_RESEARCHER_ENABLE_DEBUG=false`
## Persistence — production blocker to resolve before deployment

The NVIDIA async API's JobStore/EventStore uses SQLAlchemy async drivers. The
vendored code documents SQLite for local development and PostgreSQL for
production through `NAT_JOB_STORE_DB_URL`. A Cloudflare Container's local disk
is ephemeral; it must not be treated as durable storage for jobs, events,
checkpoints, or reports.

Cloudflare D1 is not a drop-in SQLAlchemy/asyncpg replacement for the upstream
JobStore. The vendored repository does not include a D1 or Durable Object
JobStore adapter. Therefore, do not deploy this profile in production with
SQLite on container disk, and do not claim persistent research history is ready.
For the strict Cloudflare-only requirement, implement and test a supported
Durable Object-backed persistence adapter (including job events and workflow
checkpoints) before enabling production traffic. R2 can be used for artifact
blobs where the upstream S3-compatible artifact provider is configured, but R2
does not replace the transactional job database.

Local development may use:
`NAT_JOB_STORE_DB_URL=sqlite+aiosqlite:///./jobs.db`
and a local checkpoint file. Those defaults are not production settings.

## Cloudflare Worker and Pages service binding

The repository now includes:
- `research-worker/index.js`: private research Worker, bearer-token validation,
  approved-route allowlist, Container startup, health polling, and runtime
  secret forwarding.
- `wrangler.research.jsonc`: separate Worker/Container configuration using the
  NVIDIA Dockerfile and its correct build context.
- `wrangler.jsonc`: Pages service binding named `NEXORA_RESEARCH`, targeting
  `nexora-deep-researcher`.
- `functions/api/research/[[path]].js`: Pages proxy that sends requests through
  that private service binding and streams SSE responses without exposing the
  service token to the browser.

The research Worker requires these secrets to be configured on the
`nexora-deep-researcher` Worker itself:
- `NVIDIA_API_KEY`
- `TAVILY_API_KEY`
- `EXA_API_KEY`
- `NIMBLE_API_KEY`
- `YDC_API_KEY`
- `SERPER_API_KEY`
- `NEXORA_RESEARCH_API_TOKEN`

The same `NEXORA_RESEARCH_API_TOKEN` value must be configured privately on
the Pages project. The six provider secrets currently stored on
`atlas-model-gateway` are not automatically shared with this new Worker.
Do not copy values into source code, GitHub, or browser configuration.

The research Worker also requires `NAT_JOB_STORE_DB_URL` and
`DEEP_RESEARCHER_CHECKPOINT_DB` as private runtime settings. They are
intentionally not set to SQLite defaults in the Container Worker: production
job/event and workflow checkpoint state must not live on ephemeral Container
disk. Until the Cloudflare-native persistence adapter is implemented and
these durable storage settings are supported, the Worker returns a safe
`research_runtime_not_configured` response and does not start the Container.

No Worker deployment or production routing change has been performed.

The approved API surface is the upstream async job API:
- `POST /v1/jobs/async/submit`
- `GET /v1/jobs/async/job/{job_id}`
- `GET /v1/jobs/async/job/{job_id}/stream`
- `GET /v1/jobs/async/job/{job_id}/report`
- `GET /v1/jobs/async/agents`

## Deployment gates

Do not deploy or switch production routing until all of these are true:

1. Cloudflare Container Worker and private Pages service binding are implemented.
2. All six provider secrets are present on the research Worker and passed to the
   Container process at startup without logging or returning values.
3. The Python image builds for linux/amd64 and starts the API on port 8000.
4. The Cloudflare-native durable JobStore/EventStore and checkpoint design is
   implemented and tested; ephemeral SQLite is not accepted.
5. The NEXORA auth validator is loaded and rejects missing/invalid tokens.
6. Provider smoke tests verify each configured provider without returning
   credentials in logs or API responses.
7. The Pages proxy passes request, SSE, report, and error-contract tests.

The current repository contains the vendored NVIDIA source, NEXORA auth
adapter, Pages proxy, dedicated research chat, and all-provider configuration.
It does not yet contain a deployed Cloudflare research Container, a
Cloudflare-native durable JobStore adapter, or a verified live end-to-end
research run.
