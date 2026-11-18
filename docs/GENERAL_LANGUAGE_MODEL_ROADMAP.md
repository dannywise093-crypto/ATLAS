# ATLAS General Language Model — Implementation Roadmap

## Chosen direction: open-weight foundation model + ATLAS systems

ATLAS uses an existing open-weight model as its initial language foundation while
developing its own application, memory, retrieval, evaluation, and tool interfaces.
This does not mean ATLAS trains or owns the foundation model weights.

## Implemented foundation

- Hosted foundation model: `@cf/zai-org/glm-4.7-flash` through Cloudflare Workers AI.
- Cloudflare Worker gateway with the `AI` binding.
- Server-side bearer authentication; the token is stored only in Cloudflare Worker
  secrets and Cloudflare Pages environment bindings, never in frontend code or Git.
- Cloudflare Pages Functions forward same-origin browser requests to the Worker.
- Request validation, bounded conversation history, and best-effort throttling.
- Live health check in the ATLAS dashboard.
- Automated Worker tests for authentication, health, valid chat, and invalid inputs.
- Local memory commands remain on-device.

## Current hosted inference configuration

The Worker URL is `https://atlas-model-gateway.dannywise093.workers.dev`.
The Cloudflare Pages project receives `ATLAS_GATEWAY_TOKEN` as a server-side
Pages environment variable for Production and Preview; the Worker has the matching
`ATLAS_GATEWAY_TOKEN` secret. The frontend, API routes, and AI gateway run on
Cloudflare. Vercel is not part of the deployment.

Cloudflare Workers AI currently includes 10,000 free Neurons per account per day.
The quota is shared across Workers AI usage and resets at 00:00 UTC. Usage beyond
the free allocation requires the Workers Paid plan for additional usage. Monitor
usage and confirm pricing before enabling paid usage.

## Deployment and verification

1. Cloudflare Worker deployed with Workers AI binding and bearer secret.
2. Cloudflare Pages `ATLAS_GATEWAY_TOKEN` binding matches the Worker secret.
3. Deploy Cloudflare Pages and verify `/api/health`.
4. Send real test prompts from web and Android and check actual model responses.
5. Add durable edge rate limiting, quotas, monitoring, and billing alerts before
   public traffic.

## Next milestones

1. Verify Cloudflare Pages preview and production endpoints end-to-end after deployment.
2. Benchmark response quality, latency, model limits, and neuron consumption.
3. Add streaming responses, cancellation, and robust conversation persistence.
4. Select a quantized local Android model after measuring target-device RAM,
   storage, speed, and thermal limits.
5. Add source-aware document retrieval and user-controlled persistent memory.
6. Add vision and voice as separate model capabilities.
7. Consider ATLAS-specific fine-tuning only after licensed data and evaluation
   baselines exist.

## Important limitations

The hosted model is a real inference service, but it is not trained by ATLAS.
The current Android app requires internet access for hosted inference. Offline
local-model inference is not yet implemented. The in-memory rate limiter is
best-effort; configure durable edge protection before public launch.
