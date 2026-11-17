const DEFAULT_GATEWAY_URL = "https://atlas-model-gateway.dannywise093.workers.dev";

function readEnv(name) {
  try {
    return globalThis.Netlify?.env?.get(name) || "";
  } catch {
    return "";
  }
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function validateMessages(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 24) {
    return "Provide between 1 and 24 conversation messages.";
  }

  for (const message of body.messages) {
    if (!message || !["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string" || !message.content.trim() ||
        message.content.length > 12000) {
      return "A conversation message has an invalid role or content.";
    }
  }

  if (body.messages.at(-1).role !== "user") {
    return "The latest conversation message must be from the user.";
  }

  return null;
}

export async function proxy(request, upstreamPath, method = "POST") {
  if (request.method !== method) {
    return json({ error: "Method not allowed." }, 405);
  }

  const token = readEnv("ATLAS_GATEWAY_TOKEN");
  if (!token) {
    return json({ error: "ATLAS_GATEWAY_TOKEN is not configured in Netlify site environment variables." }, 503);
  }

  let body;
  if (method === "POST") {
    const raw = await request.text();
    if (raw.length > 65536) return json({ error: "Request body is too large." }, 413);

    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "A valid JSON request body is required." }, 400);
    }

    const validationError = validateMessages(body);
    if (validationError) return json({ error: validationError }, 400);
  }

  const gatewayUrl = (readEnv("ATLAS_GATEWAY_URL") || DEFAULT_GATEWAY_URL).replace(/\/$/, "");

  try {
    const upstream = await fetch(gatewayUrl + upstreamPath, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return json({ error: "ATLAS Cloudflare model gateway could not be reached. Please retry.", retryable: true }, 502);
  }
}

export async function proxyTts(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const token = readEnv("ATLAS_TTS_GATEWAY_TOKEN") || readEnv("ATLAS_GATEWAY_TOKEN");
  if (!token) {
    return json({ error: "ATLAS_GATEWAY_TOKEN is not configured in Netlify site environment variables." }, 503);
  }

  const raw = await request.text();
  if (raw.length > 20 * 1024) return json({ error: "Speech text is too large." }, 413);

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "A valid JSON request body is required." }, 400);
  }

  if (!body || typeof body.text !== "string" || !body.text.trim() || body.text.length > 4000) {
    return json({ error: "Provide speech text between 1 and 4,000 characters." }, 400);
  }

  const gatewayUrl = (
    readEnv("ATLAS_TTS_GATEWAY_URL") ||
    readEnv("ATLAS_GATEWAY_URL") ||
    DEFAULT_GATEWAY_URL
  ).replace(/\/$/, "");

  try {
    const upstream = await fetch(gatewayUrl + "/api/tts", {
      method: "POST",
      headers: {
        Accept: "audio/mpeg, application/json",
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: body.text.trim() }),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || (upstream.ok ? "audio/mpeg" : "application/json"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return json({ error: "ATLAS speech gateway could not be reached. Please retry." }, 502);
  }
}
