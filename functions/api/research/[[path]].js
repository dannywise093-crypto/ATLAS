const MAX_BODY_BYTES = 40 * 1024;
const WINDOW_MS = 60_000;
const SUBMIT_LIMIT = 6;
const READ_LIMIT = 90;
const buckets = new Map();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function allowedRoute(path, method) {
  if (path === "agents") return method === "GET";
  if (path === "submit") return method === "POST";
  const match = path.match(/^job\/([A-Za-z0-9_-]{1,80})(?:\/(stream(?:\/[0-9]+)?|cancel|state|report))?$/);
  if (!match) return false;
  const action = match[2] || "";
  if (action === "cancel") return method === "POST";
  return method === "GET";
}

function rateLimit(request, path) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = (path === "submit" ? "submit:" : "read:") + ip;
  const now = Date.now();
  const limit = path === "submit" ? SUBMIT_LIMIT : READ_LIMIT;
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    buckets.set(key, { start: now, count: 1 });
    return false;
  }
  if (bucket.count >= limit) return true;
  bucket.count++;
  return false;
}

function validateSubmit(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "A JSON object is required.";
  if (!["deep_researcher", "shallow_researcher"].includes(body.agent_type)) {
    return "agent_type must be deep_researcher or shallow_researcher.";
  }
  if (typeof body.input !== "string" || !body.input.trim() || body.input.length > 32768) {
    return "input must contain between 1 and 32,768 characters.";
  }
  if (body.data_sources !== undefined &&
      (!Array.isArray(body.data_sources) || body.data_sources.length > 32 ||
       body.data_sources.some(value => typeof value !== "string" || value.length > 80))) {
    return "data_sources must be an array of at most 32 source IDs.";
  }
  return null;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const path = url.pathname.slice("/api/research/".length).replace(/\/$/, "");
  if (!path || !allowedRoute(path, request.method)) {
    return json({ error: "Research route not found or method not allowed." }, 404);
  }

  const token = env.NEXORA_RESEARCH_API_TOKEN;
  const researchService = env.NEXORA_RESEARCH;
  if (!token || token.length < 32 || !researchService || typeof researchService.fetch !== "function") {
    return json({
      error: "NVIDIA Deep Researcher is not connected to the Cloudflare research Worker yet.",
      code: "research_backend_not_configured"
    }, 503);
  }

  if (rateLimit(request, path)) {
    return json({ error: "Research request limit reached. Please wait and try again." }, 429);
  }

  let body;
  if (request.method === "POST") {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json({ error: "Research request body is too large." }, 413);
    }
    try { body = JSON.parse(raw); }
    catch { return json({ error: "A valid JSON request body is required." }, 400); }
    if (path === "submit") {
      const validationError = validateSubmit(body);
      if (validationError) return json({ error: validationError }, 400);
    }
  }

  const upstreamUrl = "https://nexora-deep-researcher.internal/v1/jobs/async/" + path;
  const isStream = path.includes("/stream");
  try {
    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers: {
        Authorization: "Bearer " + token,
        Accept: isStream ? "text/event-stream" : "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: request.signal
    });
    const upstream = await researchService.fetch(upstreamRequest);

    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    const contentType = upstream.headers.get("Content-Type");
    if (contentType) headers.set("Content-Type", contentType);
    if (isStream) {
      headers.set("Cache-Control", "no-cache, no-transform");
      headers.set("X-Accel-Buffering", "no");
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers
    });
  } catch {
    return json({
      error: "The NVIDIA Deep Researcher service could not be reached.",
      code: "research_backend_unreachable",
      retryable: true
    }, 502);
  }
}

export const researchProxyInternals = { allowedRoute, validateSubmit };
