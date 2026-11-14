const MODEL = "@cf/zai-org/glm-4.7-flash";
const SYSTEM_PROMPT = `You are ATLAS, a capable general-purpose AI assistant.
Be accurate, clear, and honest about uncertainty. Explain concepts clearly, solve
problems carefully, and ask for missing context when needed. Do not claim to have
used tools, accessed private files, or verified facts unless that happened.
Do not claim consciousness or guaranteed correctness. For real-world or high-impact
actions, prioritize safety and human oversight.`;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 24;
const buckets = new Map();

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...extraHeaders,
    },
  });
}

function authorized(request, env) {
  const expected = env.ATLAS_GATEWAY_TOKEN;
  if (!expected) return false;
  const supplied = request.headers.get("authorization") || "";
  return supplied.startsWith("Bearer ") && supplied.slice(7) === expected;
}

function rateLimited(request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    return false;
  }
  if (bucket.count >= MAX_PER_WINDOW) return true;
  bucket.count += 1;
  if (buckets.size > 4000) {
    for (const [key, value] of buckets) {
      if (now - value.start >= WINDOW_MS) buckets.delete(key);
    }
  }
  return false;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { allow: "GET" });
      if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
      return json({
        service: "ATLAS Cloudflare Workers AI Gateway",
        status: env.AI ? "configured" : "not_configured",
        provider: "Cloudflare Workers AI",
        model: MODEL,
      });
    }

    if (url.pathname !== "/api/chat") return json({ error: "Not found." }, 404);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
    if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
    if (rateLimited(request)) return json({ error: "Too many requests. Please wait and try again." }, 429, { "retry-after": "60" });

    const length = Number(request.headers.get("content-length") || 0);
    if (length > 64 * 1024) return json({ error: "Request body is too large." }, 413);
    let body;
    try { body = await request.json(); } catch { return json({ error: "A valid JSON body is required." }, 400); }
    if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 24) {
      return json({ error: "Provide between 1 and 24 messages." }, 400);
    }
    const messages = [];
    for (const item of body.messages) {
      if (!item || !["user", "assistant"].includes(item.role) ||
          typeof item.content !== "string" || !item.content.trim() || item.content.length > 12000) {
        return json({ error: "A message has an invalid role or content." }, 400);
      }
      messages.push({ role: item.role, content: item.content });
    }
    if (messages[messages.length - 1].role !== "user") {
      return json({ error: "The latest message must be from the user." }, 400);
    }

    try {
      const result = await env.AI.run(MODEL, {
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 1200,
        temperature: 0.6,
      });
      const answer = result?.choices?.[0]?.message?.content;
      if (typeof answer !== "string" || !answer.trim()) {
        return json({ error: "The model returned an empty or unsupported response." }, 502);
      }
      return json({ answer: answer.trim(), model: MODEL });
    } catch (error) {
      console.error("ATLAS inference request failed", error?.message || "unknown error");
      return json({ error: "ATLAS could not complete the model request. Please retry shortly." }, 502);
    }
  },
};
