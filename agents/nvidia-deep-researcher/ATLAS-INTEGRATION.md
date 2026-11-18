# ATLAS Integration: NVIDIA Deep Researcher Agent

## Repository relationship

This directory is the ATLAS-owned, version-controlled source copy of NVIDIA Deep
Researcher Agent. It is included directly in the ATLAS Git repository at:

`agents/nvidia-deep-researcher/`

It is **not** a submodule and is not fetched during installation. A standard
clone or archive download of ATLAS includes this source tree. The upstream
repository and exact imported revision are recorded in `UPSTREAM.md`.

## Component boundary

ATLAS is the application and control plane. NVIDIA Deep Researcher is a separate
Python research engine.

- ATLAS's existing React/Capacitor application and Cloudflare Worker remain the
  primary user-facing application and model gateway.
- Deep Researcher retains its own Python environment, NeMo Agent Toolkit
  dependencies, workflows, source adapters, job store, and API process.
- ATLAS should call the Deep Researcher REST API from trusted server-side code.
- Browser clients must never receive backend credentials or unrestricted access
  to the research service.
- Do not install this project's Python dependencies into ATLAS's root Node
  package or attempt to execute the research engine inside a Cloudflare Worker.

## Clone and inspect

A regular ATLAS clone already contains the component:

```bash
git clone https://github.com/dannywise093-crypto/ATLAS.git
cd ATLAS
test -f agents/nvidia-deep-researcher/pyproject.toml
test -f agents/nvidia-deep-researcher/uv.lock
test -f agents/nvidia-deep-researcher/LICENSE
```

To work on the Python project, enter its directory and follow its own README and
deployment documentation. Its declared Python range is 3.11 through 3.13. Use a
separate environment and install only on a machine intended to host the service;
the dependency set is substantial.

## Runtime and integration status

**Source vendoring is complete. Runtime integration is not implied by this
repository copy.** The backend still needs a separately provisioned runtime,
approved model and search-provider configuration, persistent job storage for
production, and an authenticated network boundary.

The intended request path is:

```text
ATLAS app
   |
   v
ATLAS Pages API / Cloudflare Worker
   |
   | authenticated server-to-server request
   v
NVIDIA Deep Researcher REST API
   |
   v
Research workflows, source tools, job store, reports
   |
   v
ATLAS returns progress and cited research results to the app
```

The backend's REST API is served in its web/API mode, not by the CLI-only
`nat run` mode. Review the upstream API and authentication documentation before
exposing any endpoint. In particular, do not expose the default unauthenticated
development configuration to the public internet. Verify the exact auth
validator contract before selecting a bearer-token or identity-propagation
scheme; do not assume that an arbitrary shared token is accepted.

Production deployment should use durable job storage (the upstream project
recommends PostgreSQL for production workloads), controlled CORS, rate limits,
request/job ownership, private secrets, and health/readiness monitoring. Keep
backend credentials in server-side secret stores only.

## Deliberate non-goals

- No duplicate clone or submodule is needed.
- No Deep Researcher dependencies are added to the ATLAS frontend or Worker.
- No backend is automatically started by `npm install`.
- No secrets, API keys, or production service URLs are committed here.
- Importing the source does not claim that Deep Researcher is already deployed
  or callable from the ATLAS interface.

## Upstream maintenance

See [`UPSTREAM.md`](UPSTREAM.md) for the imported revision and license details.
When syncing upstream, review changes against the ATLAS-owned copy, preserve
local integration documentation, and commit the reviewed update to ATLAS.
