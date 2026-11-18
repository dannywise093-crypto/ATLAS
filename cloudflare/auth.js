const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const SESSION_COOKIE = "atlas_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
let jwksCache = { keys: null, expiresAt: 0 };

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function encodeJson(value) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}
async function getGoogleKeys() {
  if (jwksCache.keys && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(GOOGLE_JWKS_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Google signing keys unavailable");
  const data = await response.json();
  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number((cacheControl.match(/max-age=(\d+)/i) || [])[1] || 3600);
  jwksCache = { keys: data.keys || [], expiresAt: Date.now() + Math.min(maxAge, 21600) * 1000 };
  return jwksCache.keys;
}
async function verifyGoogleCredential(token, clientId) {
  if (typeof token !== "string" || token.length > 12000) throw new Error("Invalid Google credential");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid Google credential");
  const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Unsupported Google credential");
  const jwk = (await getGoogleKeys()).find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) {
    jwksCache.expiresAt = 0;
    const refreshed = await getGoogleKeys();
    const replacement = refreshed.find((key) => key.kid === header.kid && key.kty === "RSA");
    if (!replacement) throw new Error("Unknown Google signing key");
    return verifyGoogleSignature(parts, replacement, claims, clientId);
  }
  return verifyGoogleSignature(parts, jwk, claims, clientId);
}
async function verifyGoogleSignature(parts, jwk, claims, clientId) {
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  const now = Math.floor(Date.now() / 1000);
  const issuerValid = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!valid || !issuerValid || claims.aud !== clientId || !claims.sub || !claims.email || claims.email_verified !== true || !Number.isFinite(claims.exp) || claims.exp <= now || (claims.iat && claims.iat > now + 300)) {
    throw new Error("Google credential validation failed");
  }
  return { sub: String(claims.sub), email: String(claims.email).toLowerCase(), name: String(claims.name || claims.given_name || "ATLAS user").slice(0, 160), picture: typeof claims.picture === "string" ? claims.picture.slice(0, 1000) : null };
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function createSession(user, secret) {
  const payload = encodeJson({ sub: user.sub, email: user.email, name: user.name, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS });
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload));
  return payload + "." + bytesToBase64Url(new Uint8Array(signature));
}
async function readSession(request, secret) {
  const cookie = request.headers.get("cookie") || "";
  const raw = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(SESSION_COOKIE + "="))?.slice(SESSION_COOKIE.length + 1);
  if (!raw || raw.length > 4096) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), base64UrlToBytes(parts[1]), new TextEncoder().encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    if (!payload.sub || !payload.email || !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { sub: payload.sub, email: payload.email, name: payload.name || "ATLAS user" };
  } catch { return null; }
}
function cookieHeader(value, maxAge) {
  return SESSION_COOKIE + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge;
}
function originAllowed(request, env) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === (env.ATLAS_APP_ORIGIN || "https://atlas-coding-chat.pages.dev"));
}
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers } });
}
export async function handleAuthRequest(request, env) {
  const url = new URL(request.url);
  if (!env.ATLAS_GOOGLE_CLIENT_ID || !env.ATLAS_SESSION_SECRET || !env.KNOWLEDGE_DB) return json({ error: "Google sign-in is not configured on the ATLAS gateway." }, 503);
  if (url.pathname === "/api/auth/google") {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
    if (!originAllowed(request, env)) return json({ error: "Request origin is not allowed." }, 403);
    let body;
    try { body = await request.json(); } catch { return json({ error: "A valid JSON body is required." }, 400); }
    try {
      const user = await verifyGoogleCredential(body?.credential, env.ATLAS_GOOGLE_CLIENT_ID);
      const now = new Date().toISOString();
      await env.KNOWLEDGE_DB.prepare("INSERT INTO atlas_users (google_sub, email, display_name, picture_url, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, picture_url = excluded.picture_url, last_login_at = excluded.last_login_at")
        .bind(user.sub, user.email, user.name, user.picture, now, now).run();
      const session = await createSession(user, env.ATLAS_SESSION_SECRET);
      return json({ user: { email: user.email, name: user.name, picture: user.picture } }, 200, { "set-cookie": cookieHeader(session, SESSION_TTL_SECONDS) });
    } catch (error) {
      console.warn("ATLAS Google sign-in rejected:", String(error?.message || "credential error").slice(0, 100));
      return json({ error: "Google sign-in could not be verified. Please try again." }, 401);
    }
  }
  if (url.pathname === "/api/auth/me") {
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { allow: "GET" });
    const user = await readSession(request, env.ATLAS_SESSION_SECRET);
    return user ? json({ user: { email: user.email, name: user.name } }) : json({ user: null }, 401);
  }
  if (url.pathname === "/api/auth/logout") {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
    if (!originAllowed(request, env)) return json({ error: "Request origin is not allowed." }, 403);
    return json({ ok: true }, 200, { "set-cookie": cookieHeader("", 0) });
  }
  return null;
}
