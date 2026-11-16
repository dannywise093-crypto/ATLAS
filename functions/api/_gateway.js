const GATEWAY_URL = "https://atlas-model-gateway.dannywise093.workers.dev";
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;
const buckets = new Map();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}

export async function proxy(request, env, path, method) {
  if (request.method !== method) return json({ error: "Method not allowed." }, 405);
  if (!env.ATLAS_GATEWAY_TOKEN) return json({ error: "ATLAS Cloudflare gateway token is not configured in Pages Functions." }, 503);
  if (method === "POST") {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const now = Date.now();
    const bucket = buckets.get(ip);
    if (!bucket || now - bucket.start >= WINDOW_MS) buckets.set(ip, { start: now, count: 1 });
    else if (bucket.count >= MAX_REQUESTS) return json({ error: "Too many requests. Please wait before trying again." }, 429);
    else bucket.count++;
  }
  let body;
  if (method === "POST") {
    const raw = await request.text();
    if (raw.length > 65536) return json({ error: "Request body is too large." }, 413);
    try { body = JSON.parse(raw); } catch { return json({ error: "A valid JSON request body is required." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 24) {
      return json({ error: "Provide between 1 and 24 conversation messages." }, 400);
    }
    for (const m of body.messages) {
      if (!m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || !m.content.trim() || m.content.length > 12000) {
        return json({ error: "A conversation message has an invalid role or content." }, 400);
      }
    }
    if (body.messages.at(-1).role !== "user") return json({ error: "The latest conversation message must be from the user." }, 400);
  }
  try {
    const upstream = await fetch(GATEWAY_URL + path, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + env.ATLAS_GATEWAY_TOKEN,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" } });
  } catch {
    return json({ error: "ATLAS Cloudflare model gateway could not be reached. Please retry.", retryable: true }, 502);
  }
}

export { json };

export async function proxyTts(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const gatewayToken = env.ATLAS_TTS_GATEWAY_TOKEN || env.ATLAS_GATEWAY_TOKEN;
  const gatewayUrl = env.ATLAS_TTS_GATEWAY_URL || GATEWAY_URL;
  if (!gatewayToken) return json({ error: "ATLAS speech gateway token is not configured in Pages Functions." }, 503);
  const raw = await request.text();
  if (raw.length > 20 * 1024) return json({ error: "Speech text is too large." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "A valid JSON request body is required." }, 400); }
  if (!body || typeof body.text !== "string" || !body.text.trim() || body.text.length > 4000) {
    return json({ error: "Provide speech text between 1 and 4,000 characters." }, 400);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const bucket = buckets.get("tts:" + ip);
  if (!bucket || now - bucket.start >= WINDOW_MS) buckets.set("tts:" + ip, { start: now, count: 1, characters: body.text.length });
  else if (bucket.count >= 8 || bucket.characters + body.text.length > 10_000) return json({ error: "Speech usage limit reached. Please wait before trying again." }, 429);
  else { bucket.count++; bucket.characters += body.text.length; }
  try {
    const upstream = await fetch(gatewayUrl + "/api/tts", {
      method: "POST",
      headers: {
        Accept: "audio/mpeg, application/json",
        Authorization: "Bearer " + gatewayToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: body.text.trim() })
    });
    if (!upstream.ok) {
      const errorText = await upstream.text();
      return new Response(errorText, {
        status: upstream.status,
        headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" }
      });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return json({ error: "ATLAS speech gateway could not be reached. Please retry." }, 502);
  }
}
