# ATLAS Google sign-in setup

Google sign-in is implemented on the `feature/google-auth` branch. This change is not deployed yet.

## Cloudflare Worker configuration

In the Cloudflare dashboard, open **Workers & Pages → atlas-model-gateway → Settings → Variables and Secrets** and configure:

- `ATLAS_GOOGLE_CLIENT_ID` (text variable): the OAuth Web Client ID created for ATLAS AI.
- `ATLAS_APP_ORIGIN` (text variable): `https://atlas-coding-chat.pages.dev` (canonical production origin).
- `ATLAS_ALLOWED_ORIGINS` (text variable, comma-separated): add each exact browser origin that should be allowed to sign in. For the current branch previews, use `https://feature-google-auth.atlas-coding-chat.pages.dev,https://atlas-git-feature-google-auth-dannywise093-crypto.vercel.app,https://atlas-cqig-git-feature-google-auth-dannywise093-crypto.vercel.app` in addition to the canonical production origin. Only include preview domains you actually use; remove temporary preview origins when no longer needed.
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

- The browser sends the Google ID token to the same-origin Pages Function. Register every browser origin used for testing in the Google OAuth Web Client under **Authorized JavaScript origins** (scheme + hostname only, no path). The Cloudflare branch preview and the two Vercel preview origins above are distinct from the production Pages origin and must each be registered if used. `ATLAS_ALLOWED_ORIGINS` must also contain those same origins so the Worker origin check accepts them.
- The Worker verifies the RS256 signature against Google's published JWKS, checks issuer, audience, expiry and verified email, then records the stable Google subject in D1.
- ATLAS issues its own seven-day HMAC-signed, HttpOnly, Secure, SameSite=Lax cookie. The signing secret remains server-side.
- The browser never receives the ATLAS session signing secret or gateway token.
- The React application renders a sign-in screen until `/api/auth/me` confirms a valid session. The workspace is not mounted before sign-in.
- Every existing Worker application API requires both the private Pages-to-Worker gateway token and a valid ATLAS session cookie. Pages proxies forward the HttpOnly cookie; direct unauthenticated Worker requests are rejected.
- This change does not yet expose NVIDIA Deep Researcher jobs or enforce research quotas. Do not enable public Deep Researcher access until its API validates ATLAS sessions and enforces job ownership on every job, report, stream, cancellation and artifact route.
- Do not enable public Deep Researcher access until its API validates ATLAS sessions and enforces job ownership on every job, report, stream, cancellation and artifact route.
