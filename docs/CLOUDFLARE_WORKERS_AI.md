# ATLAS Cloudflare Workers AI Gateway

This Worker runs ATLAS inference directly through the Cloudflare Workers AI binding.
The initial foundation model is `@cf/zai-org/glm-4.7-flash`.

## Deployment

The repository's `wrangler.jsonc` binds Workers AI as `env.AI`. Deploy the
Worker with Wrangler or the Cloudflare Workers Script Upload API, then add the
secret `ATLAS_GATEWAY_TOKEN` as a Worker secret.

The Cloudflare Pages Functions proxy forwards same-origin `/api/*` requests to
the Worker using the `ATLAS_GATEWAY_TOKEN` Pages environment binding. Neither
the token nor provider credentials are exposed to browser code. Vercel serverless
functions are not used by ATLAS.

## Usage and model

Cloudflare Workers AI currently provides 10,000 free Neurons per account per day.
The quota is shared across Workers AI usage in the account and resets at 00:00 UTC.
Exceeding the free allocation requires the Workers Paid plan for additional usage.
Check the official pricing page before enabling any paid usage.

GLM-4.7-Flash is listed as available on Workers Free. Other models can be evaluated
later by changing the Worker model constant and running the model regression set.

## Security

The Worker requires a bearer token and validates message count, roles, message
size, and method. Cloudflare Pages Functions keep the bearer token server-side.
The in-memory rate limiter is best-effort and may reset between isolates; configure
Cloudflare rate limiting before public launch.

## Limitations

This is hosted inference, not offline Android inference and not model training.
The Android application requires network access for this model. A separate local
quantized model runtime is a later milestone.
