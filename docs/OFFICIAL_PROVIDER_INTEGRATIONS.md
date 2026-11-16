# ATLAS official provider integrations

## Implemented in this branch

- ATLAS Native AI remains the default and continues using the existing Cloudflare Workers AI gateway.
- NVIDIA API Catalog hosted inference is implemented as a separate Vercel server-side route at `POST /api/nvidia`.
- NVIDIA credentials are read only from `process.env.NVIDIA_API_KEY`; they are never exposed to browser code.
- `GET /api/providers` reports server-side configuration state without returning credentials.
- The general AI Assistant has an independent provider selector. NVIDIA is disabled until its server-side key is configured. A failed NVIDIA request does not alter ATLAS Native AI configuration.

## NVIDIA deployment

1. Create an NVIDIA API Catalog account and generate an API key through NVIDIA's official developer portal.
2. In each Vercel project that serves ATLAS (Production and Preview as appropriate), add the server-side environment variable `NVIDIA_API_KEY`.
3. Do not prefix it with `VITE_`; never put it in React, localStorage, a Worker binding exposed to clients, or source control.
4. Redeploy Vercel. Visit `/api/providers` to confirm NVIDIA reports `configured: true`.
5. NVIDIA usage, model availability, and any applicable account limits are controlled by NVIDIA.

Default model: `meta/llama-3.3-70b-instruct`. The route uses NVIDIA's OpenAI-compatible Chat Completions endpoint.

## GitHub Copilot — official SDK

ATLAS Native Copilot is not GitHub Copilot. The official GitHub Copilot SDK must run in a supported Node.js backend with the Copilot CLI/runtime. It is not suitable for direct execution inside the current Cloudflare Worker.

Required before activation:
- Register and configure the official GitHub OAuth application using GitHub's documented Copilot SDK flow.
- Deploy a persistent Node.js service that runs the official `@github/copilot-sdk` runtime.
- Implement user-scoped GitHub authorization, token encryption at rest, session isolation, revocation, rate limits and audit events. Never use one developer's personal Copilot credential as a shared credential for all ATLAS users.
- Set `ATLAS_GITHUB_COPILOT_SERVICE_URL` and `ATLAS_GITHUB_COPILOT_SERVICE_TOKEN` only after that service is deployed and secured.

This branch does not claim GitHub Copilot is connected merely because configuration names exist. The UI adapter remains unavailable until a verified backend is built and deployed.

Official docs:
- https://github.com/github/copilot-sdk
- https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate
- https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth
- https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/backend-services
- https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/multi-tenancy

## Microsoft Copilot Studio

Use a published Copilot Studio agent and Microsoft's supported Direct Line/custom-client integration. ATLAS must obtain short-lived Direct Line tokens server-side; the Direct Line secret must never reach the browser.

Required configuration after creating and publishing the agent:
- `MICROSOFT_COPILOT_STUDIO_DIRECT_LINE_SECRET`
- `MICROSOFT_COPILOT_STUDIO_BOT_ID`

The adapter must use Microsoft's documented token-generation and Direct Line conversation APIs, with per-user conversation isolation and tenant authentication. A secret by itself does not establish that an agent is published or reachable.

Official docs:
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-connect-bot-to-custom-application
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-integrate-web-or-native-app-m365-agents-sdk
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/channels

## Microsoft 365 Copilot ecosystem

This is a separate integration from Copilot Studio. ATLAS should expose a Microsoft 365 Copilot-compatible agent through Microsoft's supported agent extensibility and publishing path (for example, Microsoft 365 Agents Toolkit/SDK and tenant admin deployment). It is not an API for embedding or proxying a user's consumer Microsoft 365 Copilot chat.

Required configuration for a separately deployed agent adapter:
- `MICROSOFT_365_AGENT_URL`
- `MICROSOFT_365_AGENT_TOKEN`

The final authentication and deployment flow depends on the tenant, Entra app registration, supported channel, and admin approval. Do not reuse a Copilot Studio Direct Line secret as Microsoft 365 Copilot authentication.

Official docs:
- https://learn.microsoft.com/microsoft-365/copilot/extensibility/overview

## Provider independence

Each provider has separate credentials and health state. ATLAS Native AI remains the fallback/default and does not depend on NVIDIA, GitHub, or Microsoft availability. Secrets belong in private Vercel environment variables or the dedicated provider service's secret manager. Never send secrets in chat or commit them.
