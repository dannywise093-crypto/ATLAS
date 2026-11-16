const GATEWAY_URL = "https://atlas-model-gateway.dannywise093.workers.dev";

export async function onRequest({ request, env }) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
  if (!env.ATLAS_GATEWAY_TOKEN) {
    return json({ status: "not_configured", error: "Cloudflare Pages is missing the ATLAS_GATEWAY_TOKEN secret." }, 503);
  }
  try {
    const upstream = await fetch(`${GATEWAY_URL}/api/health`, {
      headers: { accept: "application/json", authorization: `Bearer ${env.ATLAS_GATEWAY_TOKEN}` },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await upstream.json().catch(() => ({}));
    return json(payload, upstream.status);
  } catch {
    return json({ status: "unavailable", error: "ATLAS could not reach its Cloudflare model gateway." }, 502);
  }
}
