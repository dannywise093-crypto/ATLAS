# ATLAS Copilot integrations

## What this branch implements

- A dedicated `POST /api/copilot` Cloudflare Pages Function route.
- A dedicated `POST /api/copilot` Cloudflare Worker route.
- A separate ATLAS Copilot system instruction set while retaining the existing
  Workers AI model fallback chain.
- The existing gateway bearer token, request validation, rate limiting, and
  no-store response behavior remain in place.

This is ATLAS's own coding-assistant mode. It does **not** impersonate, proxy,
or claim to be GitHub Copilot or Microsoft Copilot.

## GitHub Copilot

GitHub publishes an official Copilot SDK for applications and backend services.
It drives the Copilot agent runtime and supports sessions, tool calls, streaming,
and user-scoped authentication. It must run in a compatible server process;
it should not be embedded inside the Cloudflare Worker.

Official references:
- https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup
- https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate
- https://github.com/github/copilot-sdk

Integration status: planned adapter; not connected in this change. Before enabling,
choose the user sign-in / OAuth or organization-approved server authentication
model, deploy a separate Node.js runtime, and configure per-user authorization.
Do not place Copilot credentials in browser code or Cloudflare Worker source.

## Microsoft Copilot

For a custom ATLAS client, Microsoft documents publishing Copilot Studio agents
to supported channels and using the Direct Line API for custom applications.

Official references:
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/channels
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/configuration-fundamentals

Integration status: planned adapter; not connected in this change. It requires a
published Copilot Studio agent, its supported channel/authentication configuration,
and server-side credential handling. The exact connector depends on whether the
agent is configured for Direct Line or another supported Microsoft interface.

## Required next setup

1. Add a small Node.js service for the GitHub Copilot SDK and deploy it separately.
2. Create the Microsoft Copilot Studio agent and choose its supported custom-client
   channel/authentication method.
3. Add server-side environment variables only after those services are provisioned.
4. Add explicit user authorization, tenant/session isolation, request limits,
   audit logging, and provider-specific health checks.
5. Connect the ATLAS UI to the ATLAS Copilot endpoint and then to the optional
   external adapters.

No provider credentials are present in this repository, so external Copilot
connections cannot be activated or honestly marked as operational yet.
