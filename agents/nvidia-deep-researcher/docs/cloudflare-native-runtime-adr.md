# NEXORA NVIDIA Deep Research: Cloudflare-Native Runtime ADR

Status: Proposed implementation contract  
Scope: `feat/engineering-design-development` only  
Production changes: None authorized by this document

## Decision

The production research runtime must not depend on PostgreSQL, SQLite files, or a database hidden inside the Container. Durable state must be held by Cloudflare services and accessed through explicit adapters.

Use:
- **Durable Objects (DO):** per-tenant/job coordination, atomic state transitions, idempotency, leases, event sequencing, and checkpoint transaction coordination.
- **D1:** indexed job metadata and access/admission records where cross-job queries and relational constraints are required.
- **R2:** report/artifact bytes and large checkpoint payloads; metadata stores immutable object keys, hashes, sizes, and content types.
- **Cloudflare Container:** compute only. Container disk and process memory are caches, never the source of truth.

The existing `ResearchStorage` DO record/event API remains a transport primitive. The existing `CloudflareJobMetadataRepository` is a prototype and is explicitly not a drop-in replacement for NAT's JobStore.

## Existing blockers confirmed in source

1. The MCP `deep_researcher_mcp.job_store.JobStore` is directly coupled to asyncpg/PostgreSQL and includes principal ownership, queued/running/terminal states, runner ownership, heartbeats, polling, stale-job reconciliation, TTL cleanup, and checkpoint cleanup.
2. The FastAPI async job API imports NAT's `nat.front_ends.fastapi.async_jobs.job_store.JobStore`; readiness also checks NAT's mapped SQL tables and Dask scheduler.
3. `deep_researcher_agent.common.get_checkpointer` currently selects only LangGraph's PostgreSQL or SQLite saver.
4. Artifact storage factory currently builds SQL metadata storage; S3 support is available in the vendored implementation, but must be verified for R2 compatibility and credential/signature requirements before use.
5. Current readiness policy still requires `NAT_JOB_STORE_DB_URL` and `DEEP_RESEARCHER_CHECKPOINT_DB`. Those requirements must not be removed until their replacement adapters are wired and tested.

## Implementation progress

- A bounded Cloudflare job-metadata prototype now includes revision-checked runner claims, runner-owned heartbeats, runner-fenced terminal writes, and stale-lease interruption.
- Unit coverage exercises competing claims, wrong-runner rejection, terminal-state fencing, and stale-versus-fresh lease handling.
- This prototype is **not** wired into the MCP JobManager or NAT FastAPI job store. It does not yet provide durable queue scheduling, cancellation signalling, idempotent submission, checkpoint cleanup, or complete expiry cleanup. It is not a production runtime replacement.

## Required implementation sequence

### A. Job lifecycle adapter
- Define a storage protocol independent of asyncpg, SQLAlchemy, and NAT internals.
- Implement the MCP job contract on Cloudflare storage: create, get, principal-scoped poll, conditional queued-to-running claim, runner-owned heartbeat/update, guarded failure, stale lease reconciliation, terminal-only expiry, and deletion.
- Preserve UUID job IDs, TTL semantics, runner ownership, and safe handling of ambiguous network acknowledgements.
- Make submit idempotent using a caller-supplied idempotency key scoped to the authenticated principal.
- Add concurrent claim/update tests and multi-tenant isolation tests.
- Separately adapt the FastAPI/NAT job API; do not assume the MCP adapter replaces NAT's SQLAlchemy JobStore.

### B. LangGraph checkpoint adapter
- Implement the supported LangGraph `BaseCheckpointSaver` contract for the installed LangGraph version, including `get_tuple`, `list`, `put`, and `put_writes` (sync/async variants as required).
- Preserve thread ID, checkpoint namespace, checkpoint ID, parent checkpoint config, channel versions, pending writes, metadata, and serializer/type fidelity.
- Use DO transactions for atomic checkpoint + write updates; use R2 for payloads that exceed DO/D1 limits, with hash-verified immutable blobs.
- Prove round-trip, overwrite/version, pending-write, namespace, concurrent writer, and process-restart resume behavior before switching the runtime.

### C. Durable artifact/report storage
- Store bytes in R2 and metadata/indexes in D1 or DO.
- Verify artifact ownership, path normalization, MIME sniffing, content hash, size limits, and cleanup.
- Test R2's S3-compatible endpoint with the actual artifact client before enabling it.

### D. Scheduler and recovery
- Do not rely on in-memory asyncio tasks or ephemeral Dask future references as the durable queue.
- Persist job leases and attempt IDs. A reconciler must safely re-queue or mark interrupted jobs based on checkpoint availability and lease expiry.
- Define cancellation as a durable state transition, then signal the active runner; terminal states must not be overwritten by late workers.
- Validate the actual Cloudflare Container scheduling model and plan limits before selecting the runner topology.

### E. Readiness and deployment
- Readiness must probe real D1/DO/R2 bindings and verify schema/permissions, not merely check that environment variables exist.
- Only after A-D pass may SQL URL requirements be removed from runtime policy.
- Provision provider credentials and the shared service token as Worker/Container secrets; never log or expose values.
- Deploy the research Worker, verify internal readiness, then run a real research request and validate its citations and persisted report.

## Release gates

- No SQL connection or SQLite file is opened in production.
- Job ownership isolation and idempotency pass automated tests.
- Checkpoints survive container restart and resume the same graph thread.
- Cancellation, stale-worker recovery, expiry, and cleanup pass race tests.
- R2 artifact writes are hash-verified and tenant-scoped.
- Worker readiness reports ready only when every required binding and provider secret is valid.
- A real NVIDIA research run completes end-to-end and can be reopened after a fresh client session.

## Explicit non-goals

- No fake readiness flag or placeholder backend.
- No PostgreSQL/hosted external database workaround.
- No removal of the research UI or merging into normal NEXORA chat.
- No production deployment or secret changes as part of this ADR.
