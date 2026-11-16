const GATEWAY_URL = "https://atlas-model-gateway.dannywise093.workers.dev";

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
  const token = env.ATLAS_GATEWAY_TOKEN;
  if (!token) return json({ error: "Cloudflare Pages is missing the ATLAS_GATEWAY_TOKEN secret." }, 503);
  let raw;
  try {
    raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16 * 1024) return json({ error: "Browser request is too large." }, 413);
    const body = JSON.parse(raw);
    if (!body || !["read", "links", "screenshot", "click"].includes(body.action)) {
      return json({ error: "Choose read, links, screenshot, or click." }, 400);
    }
  } catch { return json({ error: "A valid JSON request body is required." }, 400); }

  try {
    const upstream = await fetch(`${GATEWAY_URL}/api/browser`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      body: raw,
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await upstream.json().catch(() => ({}));
    return json(payload, upstream.status, upstream.status === 429 ? { "retry-after": upstream.headers.get("retry-after") || "60" } : {});
  } catch {
    return json({ error: "ATLAS could not reach the Cloudflare Browser Run gateway. Please retry." }, 502);
  }
}
