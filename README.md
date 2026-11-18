# ATLAS AI — General Language Model Foundation

ATLAS is a mobile-friendly React + Capacitor AI workspace. Its hosted model gateway uses a Llama 3.3 primary model with Gemma 4 and GLM-4.7-Flash fallbacks through Cloudflare Workers AI. ATLAS builds
its own application, memory, retrieval, evaluation, and tool systems around this
open-weight model; this repository does not claim to train its own LLM weights.

## Current architecture

- React web application and Android Capacitor wrapper.
- Cloudflare Worker gateway with a Workers AI binding.
- Llama 3.3 primary inference with Gemma 4 and GLM-4.7-Flash fallbacks through Cloudflare Workers AI.
- Cloudflare Pages Functions proxy requests to the Worker and keep the gateway token out of browser code.
- Server-side bearer authentication, input validation, and best-effort rate limits.
- Local project notes and memory commands stored in browser localStorage.
- Explicit errors instead of fabricated model responses when the service fails.

## Hosted model

When `NVIDIA_API_KEY` is configured as a private Worker secret, NVIDIA API Catalog
Llama 3.3 is primary and Cloudflare Workers AI is the fallback. Otherwise, the
Cloudflare Workers AI chain starts with `@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
then `@cf/google/gemma-4-26b-a4b-it` and `@cf/zai-org/glm-4.7-flash`. Cloudflare's current Workers AI
pricing includes 10,000 Neurons per account per day at no charge. Usage is shared
across Workers AI on the account and resets at 00:00 UTC. Exceeding the free
allocation requires the Workers Paid plan for additional usage. Review the
official [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
before enabling paid usage.

## Continuous Knowledge Engine (ACKE)

ATLAS now has an on-demand, source-aware web retrieval foundation in
`cloudflare/knowledge.js`. Requests asking for current, recent, live, or
explicitly researched information trigger a web search before model inference.
The model receives bounded evidence snippets and exact source URLs, and its
response includes a research status and retrieval timestamp.

This is retrieval-augmented generation, not continuous model retraining. The
underlying model weights do not automatically update. Persistent historical
source archives, scheduled ingestion, full-page validation, and D1-backed
knowledge storage are planned next; they are not yet enabled.

See [docs/ATLAS_CONTINUOUS_KNOWLEDGE_ENGINE.md](docs/ATLAS_CONTINUOUS_KNOWLEDGE_ENGINE.md).

## Cloudflare Worker

Worker source: `cloudflare/worker.js`
Wrangler configuration: `wrangler.jsonc`
Worker URL: `https://atlas-model-gateway.dannywise093.workers.dev`

The Worker uses an AI binding named `AI` and a server-side secret named
`ATLAS_GATEWAY_TOKEN`. The token is not included in source control.

## Cloudflare Pages frontend

The production frontend and all HTTP API routes are hosted on Cloudflare Pages at
`https://atlas-coding-chat.pages.dev/`. Pages Functions proxy same-origin `/api/*`
requests to the `atlas-model-gateway` Cloudflare Worker using the server-side
`ATLAS_GATEWAY_TOKEN` binding. The matching token is a private Worker secret and
is never sent to browser code. NVIDIA remains an optional primary inference
provider inside the Worker; Cloudflare Workers AI is the fallback and the default
when NVIDIA is not configured. Vercel is not used for ATLAS hosting, APIs, or AI.

## Local development

```bash
npm ci
npm test
npm run build
```

For a local Worker, use Wrangler with the `AI` binding configured for remote
development and set a local `ATLAS_GATEWAY_TOKEN` secret.

## Android

GitHub Actions builds a debug APK and uploads it as `atlas-ai-debug-apk`.
The Android app uses the hosted model through the Cloudflare Pages proxy, so it requires an
internet connection. This is not yet offline/local Android inference and is not
a Play Store release build.

## Security and limitations

The Worker requires bearer authentication, and Cloudflare Pages Functions keep
the gateway token server-side. Vercel serverless functions are not part of the
ATLAS runtime. The in-memory rate limiter is best-effort because isolates do not
share state; configure durable Cloudflare edge rate limiting and monitor usage
before public launch. Never commit secrets or expose them through `VITE_*` variables.

The hosted model is a real inference service, but it is not a model trained by
ATLAS. The separate local quantized Android model, vision, voice, retrieval,
persistent cross-device memory, and fine-tuning remain future milestones.

See [docs/CLOUDFLARE_WORKERS_AI.md](docs/CLOUDFLARE_WORKERS_AI.md) and
[docs/GENERAL_LANGUAGE_MODEL_ROADMAP.md](docs/GENERAL_LANGUAGE_MODEL_ROADMAP.md).

## ATLAS Copilot integrations

The `feature/atlas-copilot-integrations` work adds a dedicated ATLAS coding-assistant
mode through `/api/copilot`, reusing the secured Cloudflare model gateway and its
fallback models. This is ATLAS's own coding mode; it is not the GitHub Copilot or
Microsoft Copilot product.

The official GitHub Copilot SDK and Microsoft Copilot Studio interfaces are
documented as separate future adapters. They require their own approved
authentication, hosting, and provider configuration before they can be activated.
See [docs/COPILOT_INTEGRATIONS.md](docs/COPILOT_INTEGRATIONS.md).


## NVIDIA cuOpt numerical optimization skill

ATLAS Copilot conditionally loads NVIDIA's `cuopt-numerical-optimization-api`
guidance for relevant numerical optimization prompts. The versioned agent skill is
stored under `.agents/skills/cuopt-numerical-optimization-api/` and covers Python,
C/C++, and CLI workflows for LP, MILP, and QP (beta).

This is an **instruction/authoring integration**, not a deployed GPU solver. The
Cloudflare Worker cannot run the cuOpt native/Python solver itself. To execute
optimization jobs from the ATLAS application, provision a supported NVIDIA cuOpt
runtime on GPU infrastructure and add a separately secured server-side adapter;
never expose solver credentials or an unauthenticated solver service to browsers.
See NVIDIA's [cuOpt documentation](https://docs.nvidia.com/cuopt/user-guide/latest/)
and [cuOpt OpenAPI reference](https://docs.nvidia.com/cuopt/user-guide/latest/open-api.html).


## NVIDIA Deep Researcher Agent (vendored source)

The complete NVIDIA Deep Researcher Agent source is maintained directly inside
this repository at `agents/nvidia-deep-researcher/`. It is a normal, ATLAS-owned
Git directory—not a submodule and not an external dependency fetched during
setup. **Every normal clone of ATLAS already includes the full source tree.**

The imported source retains its own Python project, `uv.lock`, configurations,
frontends, deployment assets, tests, documentation, and license notices. Its
Python runtime is intentionally separate from ATLAS's Node.js frontend and
Cloudflare Worker. The source is present and versioned; the research backend is
not automatically installed, deployed, or connected to the live ATLAS gateway.

- [Agent components guide](agents/README.md)
- [ATLAS integration and runtime boundary](agents/nvidia-deep-researcher/ATLAS-INTEGRATION.md)
- [Imported upstream revision and license details](agents/nvidia-deep-researcher/UPSTREAM.md)
- [NVIDIA Deep Researcher source](agents/nvidia-deep-researcher/)

## NVIDIA skill orchestration

ATLAS includes the complete 451-skill NVIDIA catalog snapshot under `.agents/skills`, including each skill’s supporting references, evaluation material, benchmark report, skill card, and detached signature. The NVIDIA trust anchor is preserved at `.agents/nv-agent-root-cert.pem`. Run `npm run skills:build` after refreshing skills to regenerate `cloudflare/generated-skill-catalog.js` from `.agents/skills`, `.claude/skills`, `agent/skills`, and `agents/skills`. The Cloudflare Worker routes relevant requests to matching skill references and specialist roles; it treats skill instructions as untrusted reference data and does not execute bundled scripts. A skill’s external GPU runtime, hardware, credentials, or service must be provisioned separately. See [the ATLAS agent skills guide](.agents/README.md) and [the NVIDIA multi-agent orchestrator guide](docs/NVIDIA_MULTI_AGENT_ORCHESTRATOR.md).


## Universal robotics integration

ATLAS defines a vendor-neutral, plugin-based robotics architecture covering ROS 2/DDS, micro-ROS, USB/serial, CAN telemetry, Ethernet/TCP, manufacturer SDKs, cameras and sensors. The current Robotics Center is an offline planning/status interface only; no local bridge or hardware adapter is installed. The first integration phase is read-only discovery and telemetry with simulation-first validation. Physical actuation is not implemented or enabled. See [the robotics plugin architecture](docs/ROBOTICS_PLUGIN_ARCHITECTURE.md) and [the adapter registry manifest](cloudflare/robotics-adapter-registry.json).
