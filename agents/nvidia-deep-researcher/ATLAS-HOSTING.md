# ATLAS-hosted NVIDIA Deep Researcher

This service runs the vendored upstream NVIDIA Deep Researcher Python engine.
Build context: `agents/nvidia-deep-researcher`
Dockerfile: `deploy/Dockerfile`
Runtime stage: `release` (upstream Dockerfile default).

## Required backend secrets

- `NVIDIA_API_KEY`: NVIDIA API Catalog / Nemotron API key.
- `TAVILY_API_KEY`: Tavily search API key.
- `ATLAS_INTERNAL_TOKEN`: opaque shared token; generate a random value beginning with `atlas_` and at least 40 characters. Set the identical value as a secret on the ATLAS Cloudflare Worker.
- `REQUIRE_AUTH=true`
- `DEEP_RESEARCHER_EXTERNAL_HOSTNAMES=atlas-nvidia-deep-researcher.onrender.com`
- `CONFIG_FILE=/app/configs/config_web_default_llamaindex.yml`
- `NAT_JOB_STORE_DB_URL=sqlite+aiosqlite:////app/data/jobs.db`
- `DEEP_RESEARCHER_SUMMARY_DB=sqlite+aiosqlite:////app/data/summaries.db`
- `DEEP_RESEARCHER_CHECKPOINT_DB=/app/data/checkpoints.db`
- `DEEP_RESEARCHER_CHROMA_DIR=/app/data/chroma`

The API's own auth middleware validates the ATLAS token. Health and liveness
routes remain available for platform checks; external research routes require
the credential. The ATLAS browser must call only the ATLAS gateway, never this
service directly.

## Free-tier limitations

The upstream dependency image is substantial. Render Free has tight memory and
CPU limits and its filesystem is ephemeral. This configuration is for a first
deployment/compatibility test only; jobs and knowledge data are not durable
across instance replacement or suspension. Do not use it for production or
sensitive workloads without durable storage and adequate compute.
