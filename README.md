# ATLAS AI — General Language Model Foundation

ATLAS is a mobile-friendly React + Capacitor AI workspace. Its hosted model gateway uses a Llama 3.3 primary model with Gemma 4 and GLM-4.7-Flash fallbacks through Cloudflare Workers AI. ATLAS builds
its own application, memory, retrieval, evaluation, and tool systems around this
open-weight model; this repository does not claim to train its own LLM weights.

## Current architecture

- React web application and Android Capacitor wrapper.
- Cloudflare Worker gateway with a Workers AI binding.
- Llama 3.3 primary inference with Gemma 4 and GLM-4.7-Flash fallbacks through Cloudflare Workers AI.
- Same-origin Vercel API routes keep the gateway token out of browser code.
- Server-side bearer authentication, input validation, and best-effort rate limits.
- Local project notes and memory commands stored in browser localStorage.
- Explicit errors instead of fabricated model responses when the service fails.

## Hosted model

The primary model is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; the configured fallbacks are `@cf/google/gemma-4-26b-a4b-it` and `@cf/zai-org/glm-4.7-flash`. Cloudflare's current Workers AI
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

## Vercel projects

Both `atlas` and `atlas-cqig` use server-side environment variables in Production
and Preview:

- `ATLAS_GATEWAY_URL`
- `ATLAS_GATEWAY_TOKEN`

The frontend calls same-origin `/api/chat` and `/api/health`. Vercel forwards
requests to Cloudflare and never sends the gateway token to the browser. Redeploy
the Vercel projects after changing environment variables.

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
The Android app uses the hosted model through the Vercel API, so it requires an
internet connection. This is not yet offline/local Android inference and is not
a Play Store release build.

## Security and limitations

The Worker requires bearer authentication and the Vercel proxy keeps the token
server-side. The in-memory rate limiter is best-effort because isolates do not
share state; configure durable edge rate limiting and monitor usage before public
launch. Never commit secrets or expose them through `VITE_*` variables.

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
