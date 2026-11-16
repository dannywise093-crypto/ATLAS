const GATEWAY_URL = "https://atlas-model-gateway.dannywise093.workers.dev";

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...headers,
    },
  });
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, { allow: "POST" });
  }
  const token = env.ATLAS_GATEWAY_TOKEN;
  if (!token) {
    return json({ error: "Cloudflare Pages is missing the ATLAS_GATEWAY_TOKEN secret." }, 503);
  }

  let body;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 64 * 1024) {
      return json({ error: "Request body is too large." }, 413);
    }
    body = JSON.parse(raw);
  } catch {
    return json({ error: "A valid JSON request body is required." }, 400);
  }

  if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 24) {
    return json({ error: "Provide between 1 and 24 conversation messages." }, 400);
  }
  for (const message of body.messages) {
    if (!message || !["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string" || !message.content.trim() ||
        message.content.length > 12000) {
      return json({ error: "A conversation message has an invalid role or content." }, 400);
    }
  }
  if (body.messages[body.messages.length - 1].role !== "user") {
    return json({ error: "The latest message must be from the user." }, 400);
  }

  try {
    const upstream = await fetch(`${GATEWAY_URL}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages: body.messages }),
      signal: AbortSignal.timeout(110_000),
    });
    const payload = await upstream.json().catch(() => ({}));
    return json(payload, upstream.status, upstream.status === 429 ? { "retry-after": upstream.headers.get("retry-after") || "60" } : {});
  } catch {
    return json({ error: "ATLAS could not reach its Cloudflare model gateway. Please retry.", retryable: true }, 502);
  }
}
