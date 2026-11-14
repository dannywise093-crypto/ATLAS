# ATLAS General Language Model — Implementation Roadmap

## Chosen direction: open-weight foundation model + ATLAS systems

ATLAS uses an existing open-weight model as its initial language foundation while
developing its own application, gateway, memory, retrieval, evaluation, and tool
interfaces. This does not mean the current experimental ATLAS-1 checkpoint is
already a capable general-purpose LLM.

## Implemented integration

- FastAPI model gateway in `server/main.py`.
- Optional bearer-token authentication; the Render Blueprint generates a token.
- Vercel serverless routes in `api/` keep the gateway token out of browser code.
- Request validation and best-effort per-instance rate limiting at the proxy.
- OpenAI-compatible upstream chat-completions contract.
- Honest frontend errors when the backend or model is not configured.
- Local memory commands remain on-device.

## Deployment sequence

1. Create the Render Blueprint from `render.yaml`.
2. Set the real inference service's `ATLAS_UPSTREAM_BASE_URL` and exact
   `ATLAS_MODEL_ID` in Render; set its private API key only if required.
3. Copy Render's generated `ATLAS_GATEWAY_TOKEN` into both Vercel projects as
   server-side `ATLAS_GATEWAY_TOKEN`, and set `ATLAS_GATEWAY_URL`.
4. Redeploy Vercel and verify `/api/health` reports `status: configured`.
5. Send a real test prompt and verify the response came from the selected model.
6. Add durable edge rate limiting, quotas, monitoring, and billing alerts before
   inviting public traffic.

No model weights, hosting account, provider account, or paid inference is supplied
by this repository. A real compatible inference endpoint is still required.

## Model selection policy

Do not assume one model will fit every target. Evaluate candidate open-weight
instruction models using the same benchmark set. Record exact model ID, license,
quantization, context length, RAM/VRAM use, tokens per second, latency, and cost.

For Android, begin with a small quantized model and benchmark on the exact phone.
For stronger reasoning and broader knowledge, use a larger hosted/self-hosted model
through the same gateway. The current Android app uses the remote gateway; offline
local-model inference is a separate milestone and is not yet implemented.

## Next milestones

1. Deploy and smoke-test the gateway against a real open-weight model endpoint.
2. Select a local Android model after measuring target device RAM, storage, speed,
   and thermal limits.
3. Add streaming responses, cancellation, and conversation context management.
4. Add source-aware document retrieval and user-controlled persistent memory.
5. Add automated quality, safety, latency, and regression evaluations.
6. Add vision and voice as separate model capabilities.
7. Consider ATLAS-specific fine-tuning only after licensed data and evaluation
   baselines exist.

## Important limitations

The gateway forwards requests; it does not create or train new model weights.
No inference server or model weights are bundled in this repository. A compatible
model service must be configured before general-purpose chat is available.
