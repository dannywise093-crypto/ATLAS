# ATLAS Google sign-in setup

Google sign-in is implemented on the `feature/google-auth` branch. This change is not deployed yet.

## Cloudflare Worker configuration

In the Cloudflare dashboard, open **Workers & Pages → atlas-model-gateway → Settings → Variables and Secrets** and configure:

- `ATLAS_GOOGLE_CLIENT_ID` (text variable): the OAuth Web Client ID created for ATLAS AI.
- `ATLAS_APP_ORIGIN` (text variable): `https://atlas-coding-chat.pages.dev`.
- `ATLAS_SESSION_SECRET` (secret): generate a unique random value with at least 32 bytes of entropy. Do not commit it or share it in chat.

The existing `ATLAS_GATEWAY_TOKEN` must remain configured on the Worker, and the matching value must remain configured as a Pages Function secret. Do not rotate it as part of this change.

## D1 migration

The migration adds only the `atlas_users` identity table; it does not alter the existing knowledge archive tables.

From the ATLAS repository root, apply it to the existing remote database:

```bash
npx wrangler d1 migrations apply atlas-knowledge-archive --remote
```

Confirm the database name matches `wrangler.jsonc` before applying.

## Deploy order

1. Configure the Worker variables and secret.
2. Apply the D1 migration.
3. Deploy the Worker.
4. Deploy the Pages app so the same-origin `/api/auth/*` Pages Function is available.
5. Test sign-in, refresh persistence, sign-out, and a second Google account.

## Security behavior

- The browser sends the Google ID token to the same-origin Pages Function.
- The Worker verifies the RS256 signature against Google's published JWKS, checks issuer, audience, expiry and verified email, then records the stable Google subject in D1.
- ATLAS issues its own seven-day HMAC-signed, HttpOnly, Secure, SameSite=Lax cookie. The signing secret remains server-side.
- The browser never receives the ATLAS session signing secret or gateway token.
- Existing public chat remains unchanged; this account foundation does not yet expose NVIDIA Deep Researcher jobs or enforce research quotas.
- Do not enable public Deep Researcher access until its API validates ATLAS sessions and enforces job ownership on every job, report, stream, cancellation and artifact route.
