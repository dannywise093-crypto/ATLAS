# NEXORA AI — NEXORA TECHNOLOGIES

**NEXORA TECHNOLOGIES** is the parent technology brand. **NEXORA AI** is its flagship artificial-intelligence and engineering research platform.

> **Next-Generation Engineering, Research & Advanced Artificial Intelligence.**  
> *Building Intelligence. Engineering Tomorrow.*

NEXORA AI is a mobile-friendly React + Capacitor workspace for conversational intelligence, research, engineering workflows, software development, learning, vision previews, voice, and safe robotics integration.

This repository retains its historical GitHub name, `ATLAS`, during the staged rebrand. Existing source identifiers, API bindings, storage keys, worker names, deployment URLs, and secrets are deliberately preserved where changing them could break compatibility or user data. The visible product identity is NEXORA AI.

## Brand architecture

- **NEXORA TECHNOLOGIES** — parent organization and corporate brand.
- **NEXORA AI** — flagship AI platform.
- **NEXORA ENGINEERING** — engineering and CAD capabilities.
- **NEXORA RESEARCH** — scientific research and knowledge workflows.
- **NEXORA ROBOTICS** — robotics discovery, simulation, and read-only telemetry.
- **NEXORA LABS** — experimental technology and innovation.
- **NEXORA SYSTEMS** — software and infrastructure.

Brand assets and usage guidance: [docs/BRAND_IDENTITY.md](docs/BRAND_IDENTITY.md).

## Current architecture

- React web application and Android Capacitor wrapper.
- Cloudflare Worker gateway with a Workers AI binding.
- Llama 3.3 primary inference with Gemma 4 and GLM-4.7-Flash fallbacks through Cloudflare Workers AI.
- Cloudflare Pages Functions proxy requests to the Worker and keep the gateway token out of browser code.
- Server-side bearer authentication, input validation, and best-effort rate limits.
- Local project notes and memory commands stored in browser localStorage.
- Explicit errors instead of fabricated model responses when the service fails.

## Hosted model

When `NVIDIA_API_KEY` is configured as a private Worker secret, NVIDIA API Catalog Llama 3.3 is primary and Cloudflare Workers AI is the fallback. Otherwise, the Cloudflare Workers AI chain starts with `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, then `@cf/google/gemma-4-26b-a4b-it` and `@cf/zai-org/glm-4.7-flash`.

Review the official [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) before enabling paid usage.

## Continuous Knowledge Engine

NEXORA AI includes request-time, source-aware web retrieval in `cloudflare/knowledge.js`. This is retrieval-augmented generation, not continuous model retraining. The underlying model weights do not automatically update.

See [docs/ATLAS_CONTINUOUS_KNOWLEDGE_ENGINE.md](docs/ATLAS_CONTINUOUS_KNOWLEDGE_ENGINE.md). The historical filename is retained to avoid breaking links.

## Cloudflare Worker and frontend

Worker source: `cloudflare/worker.js`  
Wrangler configuration: `wrangler.jsonc`

The existing Worker URL, Pages origin, and `ATLAS_GATEWAY_TOKEN` secret name are retained for compatibility during this rebrand. Secrets must remain server-side and must never be committed or exposed through browser variables.

## Local development

```bash
npm ci
npm test
npm run build
```

## Android

GitHub Actions builds a debug APK. The Capacitor display name is updated to NEXORA AI. The existing Android application ID is intentionally retained in this first branding phase so existing installations can receive compatible updates without changing their package identity.

## Robotics and safety

The Robotics Center uses a vendor-neutral adapter architecture. Hardware integrations must accurately report their implementation status. Discovery, simulation, and read-only telemetry are separate from physical actuation; physical movement and actuator commands are not enabled by this branding change.

See [the robotics plugin architecture](docs/ROBOTICS_PLUGIN_ARCHITECTURE.md) and [the adapter registry manifest](cloudflare/robotics-adapter-registry.json).

## Rebrand compatibility policy

This first phase updates the product-facing identity, web metadata, logo, package display name, Android display name, and primary documentation. It does **not** rename the GitHub repository, Cloudflare Worker, Pages project, environment variables, API routes, local-storage namespaces, internal JavaScript identifiers, or historical technical document paths. Those require separate migration planning and validation.
