const GATEWAY_URL = "https://atlas-model-gateway.dannywise093.workers.dev";
const buckets = new Map();
export async function onRequestPost({ request, env }) {
  if (!env.ATLAS_GATEWAY_TOKEN) return Response.json({ error: "Engineering image gateway is not configured." }, { status: 503 });
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now(); const old = buckets.get(ip);
  if (!old || now - old.start > 60_000) buckets.set(ip, { start: now, count: 1 });
  else if (old.count >= 3) return Response.json({ error: "Image-generation limit reached. Please wait one minute." }, { status: 429 });
  else old.count++;
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "A valid JSON body is required." }, { status: 400 }); }
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 1800) {
    return Response.json({ error: "Provide an engineering visual prompt under 1,800 characters." }, { status: 400 });
  }
  try {
    const upstream = await fetch(GATEWAY_URL + "/api/engineering/visual", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.ATLAS_GATEWAY_TOKEN, "Content-Type": "application/json", Accept: "image/png, application/json" },
      body: JSON.stringify({ prompt: body.prompt.trim() })
    });
    if (!upstream.ok) {
      const payload = await upstream.json().catch(() => ({}));
      return Response.json({ error: payload.error || "The image-generation service failed." }, { status: upstream.status });
    }
    return new Response(upstream.body, { status: 200, headers: { "Content-Type": upstream.headers.get("Content-Type") || "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ error: "The engineering image gateway could not be reached." }, { status: 502 });
  }
}
export async function onRequest({ request }) {
  return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: { Allow: "POST", "Content-Type": "application/json" } });
}
