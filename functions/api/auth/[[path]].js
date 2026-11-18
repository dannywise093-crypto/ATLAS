const GATEWAY_URL = "https://atlas-model-gateway.dannywise093.workers.dev";
const PRODUCTION_ORIGIN = "https://atlas-coding-chat.pages.dev";
function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin) return false;
    if (origin === PRODUCTION_ORIGIN) return true;
    // Cloudflare Pages PR preview origins use a hexadecimal deployment ID.
    return /^[a-f0-9]{8,32}\\.atlas-coding-chat\\.pages\\.dev$/i.test(url.hostname);
  } catch {
    return false;
  }
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export async function onRequest({ request, env }) {
  const path = new URL(request.url).pathname;
  const methods = { "/api/auth/google": "POST", "/api/auth/me": "GET", "/api/auth/logout": "POST" };
  const method = methods[path];
  if (!method) return json({ error: "Not found." }, 404);
  if (request.method !== method) return json({ error: "Method not allowed." }, 405);
  if (!env.ATLAS_GATEWAY_TOKEN) return json({ error: "ATLAS gateway is not configured." }, 503);
  const origin = request.headers.get("origin");
  if (method === "POST" && !isAllowedOrigin(origin)) return json({ error: "Request origin is not allowed." }, 403);
  let body;
  if (method === "POST") {
    const raw = await request.text();
    if (raw.length > 20000) return json({ error: "Request body is too large." }, 413);
    try { body = JSON.parse(raw); } catch { return json({ error: "A valid JSON request body is required." }, 400); }
    if (path === "/api/auth/google" && (typeof body?.credential !== "string" || body.credential.length > 12000)) return json({ error: "A Google credential is required." }, 400);
  }
  try {
    const upstream = await fetch(GATEWAY_URL + path, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + env.ATLAS_GATEWAY_TOKEN,
        ...(request.headers.get("cookie") ? { Cookie: request.headers.get("cookie") } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const headers = new Headers({ "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) headers.append("Set-Cookie", setCookie);
    return new Response(await upstream.text(), { status: upstream.status, headers });
  } catch {
    return json({ error: "ATLAS sign-in service could not be reached. Please retry." }, 502);
  }
}
