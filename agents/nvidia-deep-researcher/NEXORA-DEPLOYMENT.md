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

## Authenticated runtime readiness probe

The research Worker exposes `GET /internal/readiness` behind the existing
`NEXORA_RESEARCH_API_TOKEN` bearer check. It reports only configuration
booleans, selected event-store mode, and missing setting names; it never
returns secret values. This endpoint does not start the Container or perform
provider API calls. A configured response is only a deployment preflight, not
proof of a live NVIDIA request.

The current Cloudflare account inspection found no deployed
`nexora-deep-researcher` Worker. The Pages service binding in
`wrangler.jsonc` therefore currently targets a service that is not present in
the account. Existing provider secret names (including NVIDIA, Tavily, Exa,
Nimble, You.com, and Serper) are present on `atlas-model-gateway`, but
Cloudflare does not allow those secret values to be read back or implicitly
shared with a new Worker. They must be separately provisioned on the research
Worker by the account owner; never attempt to copy them through source code.

The Container startup currently still expects SQLAlchemy JobStore and
LangGraph checkpoint database settings. The Cloudflare event adapter is only
one part of the persistence contract and does not replace those stores. The
readiness endpoint intentionally reports missing settings instead of
pretending the Durable Object event store makes the full runtime durable.

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


## Persistence adapter investigation — verified source findings

The pinned NVIDIA/NeMo implementation has no existing Cloudflare D1 or Durable Object persistence adapter. The current runtime has several independent persistence consumers, so replacing only the front-end database URL would be incomplete:

1. **NAT async JobStore** — the pinned NeMo Agent Toolkit JobStore is a SQLAlchemy ORM implementation. It persists JobInfo records and manages Dask futures. It uses async SQLAlchemy sessions and ORM operations, not a pluggable key/value storage interface.
2. **Deep Researcher EventStore** — the vendored API has its own SQLAlchemy EventStore. It performs synchronous and asynchronous SQL operations for event replay and SSE; PostgreSQL additionally uses LISTEN/NOTIFY, while SQLite uses polling.
3. **Research admission/access metadata** — vendored API modules use direct database connections and SQL statements for admission limits, ownership, and conversation-to-report lookup. These must be migrated as well.
4. **LangGraph workflow checkpoints** — the vendored get_checkpointer() factory explicitly selects AsyncPostgresSaver for PostgreSQL DSNs and AsyncSqliteSaver for local SQLite. There is no Durable Object saver in the pinned source.
5. **Dask execution** — async job submission stores scheduler futures and Dask variables in addition to SQL metadata. Durable metadata alone would not make a running job survive a Container/Dask scheduler restart.

Cloudflare outbound HTTP intercepts provide a viable transport from a Container to a WorkerEntrypoint with access to Durable Object bindings. They do not supply a SQLAlchemy dialect, a JobStore implementation, an EventStore implementation, or a LangGraph checkpointer. A Cloudflare-native design must therefore implement and contract-test each persistence adapter and define recovery semantics for Dask jobs before the runtime can be considered durable. Do not substitute a remote HTTP wrapper around only the EventStore and call the whole system persistent.

### Python-to-Cloudflare transport milestone

A Python transport client now exists at
`frontends/deep_researcher_api/src/deep_researcher_api/jobs/cloudflare_storage.py`.
It uses the authenticated Worker routes to read/write tenant-scoped records and
append/read paginated job events. It includes synchronous and async wrappers,
optimistic revision support, strict identifier validation, bounded response
reads, and typed conflict/not-found errors.

The Python client expects these private runtime settings:
- `NEXORA_RESEARCH_STORAGE_URL`: the HTTPS origin of the research Worker
  (origin only; no path, query, or fragment).
- `NEXORA_RESEARCH_API_TOKEN`: the same secret used by the research Worker.

The client is a transport layer only. It is **not wired into NAT's JobStore**,
the API routes, EventStore, admission/access SQL, LangGraph checkpoint saver,
or Dask recovery. Do not remove the existing SQLAlchemy configuration or
enable the research Container on the strength of this client alone. The next
adapter task must preserve NAT's required Dask future lifecycle while replacing
the `job_info` ORM contract and the direct SQL consumers atomically.

Focused tests are in
`frontends/deep_researcher_api/tests/test_cloudflare_storage.py`. They have
been added but have not yet been executed in this environment.

### Required implementation sequence

- Define a versioned Durable Object storage API for jobs, events, admission, ownership, report references, and checkpoints, with atomic per-job writes, pagination, expiry, and tenant scoping.
- Implement a NAT-compatible JobStore adapter (or a narrowly maintained upstream patch) and verify all methods used by the async routes and Dask runner.
- Replace the vendored EventStore and direct SQL access paths with the same durable storage contract; retain SSE replay and polling semantics without relying on PostgreSQL notifications.
- Implement a LangGraph BaseCheckpointSaver backed by the storage contract and test checkpoint listing, reads, writes, versions, and thread isolation.
- Define what happens when a Container or local Dask scheduler stops during a job. Either add durable task recovery/reattachment or explicitly mark interrupted jobs and allow safe retry; never report an unfinished task as successful merely because its metadata survived.
- Add integration tests against a local Durable Object-compatible test harness before considering deployment.

### Upstream lifecycle risk

The official NeMo Agent Toolkit repository announced deprecation in October 2026 and end-of-life by the end of 2026. The vendored project pins nvidia-nat 1.8.0, so production readiness also requires an explicit decision on supported successor compatibility or a maintained fork. This does not change the user's pinned NVIDIA source revision; it is a dependency-lifecycle risk to resolve before production.

## Durable Object storage API scaffold — not yet an NVIDIA adapter

The research Worker now exports a SQLite-backed `ResearchStorageObject` and
exposes it only through the authenticated private route prefix
`/internal/storage/v1/...`. The current version provides:

- Tenant-scoped JSON records with monotonically increasing revisions and
  optional optimistic concurrency checks.
- Tenant/job-scoped append-only event records with sequence numbers and
  bounded pagination.
- Identifier validation, bearer-token checks at both Worker and Durable
  Object boundaries, payload-size limits, and strict JSON-object validation.

This is a storage primitive only. It does **not** yet implement the NAT
SQLAlchemy JobStore interface, the vendored EventStore interface, admission /
ownership queries, LangGraph checkpoint saver, or Dask task recovery. The
Python Container does not yet call this API. Therefore it must not be described
as durable NVIDIA job persistence, and the Worker continues to require the
existing fail-closed runtime configuration.

The storage API also needs Durable Object runtime contract tests (including
concurrent writes, revision conflicts, event ordering, tenant isolation,
pagination boundaries, malformed payloads, and unauthorized requests) before
deployment. The current Node policy tests do not exercise the SQLite-backed
Durable Object itself.

**Current result:** the repository remains fail-closed. No external database has been introduced, no ephemeral SQLite persistence has been enabled for production, and no Cloudflare deployment or production routing change has been made.


### Durable record collection API milestone

The Durable Object gateway now supports bounded, key-ordered pagination for a
single tenant and namespace using `GET /v1/tenants/:tenant/records/:namespace?after=:key&limit=:n`.
The Python transport client exposes this as `list_records`. The cursor is an
exclusive record key; pages are capped at 200 entries and return `nextAfter`
when another page exists. This supplies a prerequisite for enumerating job
records without loading an unbounded collection into memory.

This does not implement NAT `JobStore` semantics. The upstream store also
creates and updates relational `JobInfo` rows, tracks Dask futures in scheduler
Variables, cancels futures, expires jobs, and performs status/expiry queries.
The NEXORA API additionally depends on transactional admission and ownership
records, SQL joins, event-store behavior, and LangGraph checkpoints. Those
contracts still require explicit adapters and integration tests before the
NVIDIA API can be switched to Cloudflare-native persistence.


### Cloudflare job metadata repository milestone

The Python backend now contains a separate
`CloudflareJobMetadataRepository` prototype over the Durable Object record
transport. It provides tenant-scoped create/read/update, revision-checked
updates with bounded conflict retries, paginated enumeration, status filtering,
and expiry-time calculation. Its tests use an in-memory storage fake and do not
contact Cloudflare.

This repository is intentionally **not wired into NVIDIA's FastAPI routes or
NAT's `JobStore`**. It does not implement Dask submission, scheduler
`Variable` future tracking, cancellation, worker restart recovery, Dask future
cleanup, NAT's SQLAlchemy `JobInfo` ORM/session contract, or the existing
admission/access SQL transactions. Its metadata dataclass is not a SQLAlchemy
`JobInfo` instance. It is a focused adapter prototype for validating the
Durable Object record model, not production-ready job lifecycle persistence.

Next integration work must preserve the actual NAT lifecycle and NEXORA's
ownership/admission invariants. In particular, the current SQL-based
readiness probe and route startup must not be bypassed until the API, runner,
cancellation monitor, admission/access helpers, EventStore, and checkpoint
saver have coordinated Cloudflare-native replacements and integration tests.


### Cloudflare event persistence adapter milestone

Added `CloudflareEventStore` as a separate prototype over the Durable Object
event append/read API. It preserves per-job sequence IDs as the existing
`_id` cursor expected by event consumers, supports sync and async reads,
single-event writes, and batch writes (implemented as ordered individual
appends, not an atomic transaction). It also mirrors the existing encrypted
artifact-content preparation/return hooks when a content cipher is supplied.
Tests use an in-memory fake and do not contact Cloudflare.

The adapter is not wired into `AgentEventCallback`, `BatchingEventStore`,
FastAPI SSE routes, or the runner. The existing route layer calls
`EventStore.get_events_async(db_url, ...)`; the new adapter instead requires an
explicit authenticated `CloudflareStorageClient`. The current Worker event
API does not provide PostgreSQL LISTEN/NOTIFY, so live updates still require
polling or a separately designed Durable Object/WebSocket notification path.
Batch append is not atomic, and no cross-job event cleanup/retention policy has
been migrated. Do not disable the SQL EventStore based on this adapter alone.


### Coordinated tenant-aware Cloudflare event backend milestone

The shared `event_reader` now selects SQL or Cloudflare reads, and the job
runner now uses the matching `build_event_store_for_job` factory for its
primary writer and all cancellation/error fallback writers. The same
`NEXORA_RESEARCH_EVENT_STORE` setting therefore switches event reads and
writes together; SQL remains the default. Source-failure final-report events
also flow through the selected writer rather than bypassing it with a direct
SQL EventStore write.

Cloudflare tenant identity is derived only from persisted
`job_access.owner_auth_type` and `owner_subject` metadata. The stable tenant
key is SHA-256-derived; the raw owner subject is not sent as the tenant key.
Missing owner metadata or invalid Cloudflare configuration fails closed.
Artifact and SSE polling readers use the same boundary. Cloudflare SSE uses
polling, not PostgreSQL LISTEN/NOTIFY.

This is a **partial event-store migration, not a production-ready NVIDIA
runtime**. The following remain SQL-backed or incomplete:

- NAT async JobStore ORM contract, Dask scheduler future tracking, cancellation
  metadata, expiry and interrupted-job recovery.
- Admission limits, ownership/access transactions and direct SQL consumers.
- LangGraph workflow checkpoint saver and checkpoint thread isolation.
- Durable artifact blob storage, cross-job event retention/cleanup and
  transactional coordination between terminal status and final events.
- Cloudflare Durable Object runtime integration tests and live end-to-end
  Container/provider verification.

Do not enable `NEXORA_RESEARCH_EVENT_STORE=cloudflare` in production until
these remaining storage contracts are implemented and tested together. The
flag is intentionally not set by this change. No secrets, DNS, production
routing, or Cloudflare deployment were changed.

