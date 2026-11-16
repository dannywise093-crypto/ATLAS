const NVIDIA_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MODEL = "meta/llama-3.3-70b-instruct";
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 12;
const buckets = new Map();

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.NVIDIA_API_KEY) {
    return json({ error: "NVIDIA hosted inference is not configured. Add NVIDIA_API_KEY as a Cloudflare Pages secret for Preview and Production." }, 503);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.start >= WINDOW_MS) buckets.set(ip, { start: now, count: 1 });
  else if (bucket.count >= MAX_REQUESTS) return json({ error: "Too many NVIDIA requests. Please wait and retry." }, 429, { "Retry-After": "60" });
  else bucket.count++;

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 65_536) return json({ error: "Request body is too large." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "A valid JSON request body is required." }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 24) {
    return json({ error: "Provide between 1 and 24 conversation messages." }, 400);
  }

  const messages = [];
  for (const item of body.messages) {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string" || !item.content.trim() || item.content.length > 12_000) {
      return json({ error: "A conversation message has an invalid role or content." }, 400);
    }
    messages.push({ role: item.role, content: item.content });
  }
  if (messages[messages.length - 1].role !== "user") return json({ error: "The latest message must be from the user." }, 400);

  const model = typeof body.model === "string" && /^[a-zA-Z0-9._/-]{1,120}$/.test(body.model)
    ? body.model : DEFAULT_MODEL;

  let upstream;
  try {
    upstream = await fetch(NVIDIA_CHAT_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + env.NVIDIA_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 4096, stream: false }),
      signal: AbortSignal.timeout(100_000)
    });
  } catch {
    return json({ error: "NVIDIA hosted inference could not be reached. Please retry.", retryable: true }, 502);
  }

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const message = typeof payload?.detail === "string" ? payload.detail :
      typeof payload?.error?.message === "string" ? payload.error.message : "NVIDIA inference request failed.";
    return json({ error: message }, upstream.status === 401 || upstream.status === 403 ? 503 : upstream.status);
  }

  const answer = payload?.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) return json({ error: "NVIDIA returned an empty response.", retryable: true }, 502);
  return json({ answer: answer.trim(), provider: "NVIDIA API Catalog", model });
}

export async function onRequest({ request }) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
}
