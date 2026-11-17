# ATLAS Gemini Live Voice

ATLAS Voice Center uses Google's Gemini Live API for real-time audio-to-audio conversation. This integration is limited to the Voice Center; normal ATLAS text chat, Copilot, memory, and other modules continue using their existing services.

## Provider and free tier

- Model: `gemini-3.8-live`.
- Google currently lists a free tier for this Live model. Free-tier availability is subject to Google's quotas, rate limits, account eligibility, and policy changes.
- Google states that content submitted on the free tier may be used to improve its products. In this ATLAS integration, only live Voice Center audio is sent to Google. Normal text-chat messages are not routed to Gemini Live.
- Do not speak passwords, financial details, private identifiers, or other sensitive information into the free-tier voice session.

## Required server secret

Add `GEMINI_API_KEY` as a **Worker secret** on the `atlas-model-gateway` Cloudflare Worker. Never add this key to Vite variables, browser code, Pages public variables, or the Git repository.

Using Wrangler from a trusted development environment:

```sh
wrangler secret put GEMINI_API_KEY
```

Paste the Gemini API key when prompted. The Worker uses it only to request a one-use, short-lived Live API token. The browser receives that temporary token, not the permanent API key.

The Pages Functions deployment must retain its existing `ATLAS_GATEWAY_TOKEN` secret so `POST /api/voice-token` can authenticate to the Worker.

## Deployment

1. Deploy the updated Worker after merging the change.
2. Confirm `GEMINI_API_KEY` exists as a Worker secret.
3. Deploy the updated Cloudflare Pages application so the new `/api/voice-token` Pages Function is available.
4. Open ATLAS over HTTPS, enter Voice Center, and allow microphone access.

If the free quota is exhausted or the model is unavailable, Voice Center reports an error; it does not silently switch to a paid provider. The normal text-chat service remains unchanged.
