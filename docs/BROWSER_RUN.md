# ATLAS Browser Run integration

ATLAS now has a first Browser Center backed by Cloudflare Browser Run Quick Actions.

## Included

- Rendered-page reading through the `markdown` quick action.
- Link discovery through the `links` quick action.
- Link following by navigating to a discovered HTTP(S) link and reading its destination.
- Screenshot capture through the `screenshot` quick action.
- Same-origin Pages proxy at `POST /api/browser`; the gateway token remains server-side.
- A `BROWSER` binding in `wrangler.jsonc`.

## Required deployment setup

The Browser Run binding is declared in the Worker configuration, but it becomes available only after the Worker is deployed with Browser Run enabled for the Cloudflare account. Deploy the gateway with the updated `wrangler.jsonc`. The Cloudflare Pages deployment must also include `functions/api/browser.js` and the Browser Center UI.

The Pages environment must retain the existing `ATLAS_GATEWAY_TOKEN` secret. No new browser API token is required when using the Worker binding.

## Current scope and limitations

This is the stateless Quick Actions integration. It can render and read public pages, extract links, follow a link by navigating to its URL, and capture a screenshot. It does **not** yet provide a persistent interactive browser session, arbitrary DOM clicking, typing into form fields, authenticated sessions, or submitting forms. Those require a Browser Run session with Puppeteer/Playwright or CDP and a carefully controlled session lifecycle.

The URL validator rejects common local/private/link-local host patterns and non-HTTP(S) schemes. This is a defense-in-depth check, not a complete DNS-rebinding or redirect-time SSRF boundary. Do not use this first version to access private infrastructure or sensitive authenticated pages. A full interactive session implementation must add request-level egress validation, redirect revalidation, session ownership/expiry, and explicit human confirmation before consequential website actions.

## API

Send a POST request to `/api/browser` with one of:

```json
{ "action": "read", "url": "https://example.com" }
{ "action": "links", "url": "https://example.com" }
{ "action": "screenshot", "url": "https://example.com" }
{ "action": "click", "href": "https://example.com/about" }
```

All calls go through the authenticated Pages Function. Do not put the gateway token in browser JavaScript.
