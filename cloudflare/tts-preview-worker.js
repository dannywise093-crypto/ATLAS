const WINDOW_MS = 60_000;
const MAX_REQUESTS = 8;
const MAX_CHARACTERS = 10_000;
const buckets = new Map();

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...headers,
    },
  });
}

function authorized(request, env) {
  const expected = env.ATLAS_TTS_GATEWAY_TOKEN;
  const supplied = request.headers.get("Authorization") || "";
  if (!expected || !supplied.startsWith("Bearer ")) return false;
  const actual = supplied.slice(7);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return difference === 0;
}

function rateLimited(request, characterCount) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1, characters: characterCount });
    return false;
  }
  if (bucket.count >= MAX_REQUESTS || bucket.characters + characterCount > MAX_CHARACTERS) return true;
  bucket.count++;
  bucket.characters += characterCount;
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
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
      if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
      return json({ service: "ATLAS TTS preview gateway", status: env.AI ? "configured" : "not_configured", model: "@cf/deepgram/aura-2-en", speaker: "draco" });
    }
    if (url.pathname !== "/api/tts") return json({ error: "Not found." }, 404);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
    if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);

    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > 20 * 1024) return json({ error: "Speech text is too large." }, 413);
    let body;
    try { body = await request.json(); } catch { return json({ error: "A valid JSON body is required." }, 400); }
    const speechText = typeof body?.text === "string" ? body.text.trim() : "";
    if (!speechText || speechText.length > 4000) {
      return json({ error: "Provide speech text between 1 and 4,000 characters." }, 400);
    }
    if (rateLimited(request, speechText.length)) {
      return json({ error: "Speech usage limit reached. Please wait before trying again." }, 429, { "Retry-After": "60" });
    }
    if (!env.AI) return json({ error: "Cloudflare Workers AI is not configured for speech." }, 503);

    try {
      const audio = await env.AI.run("@cf/deepgram/aura-2-en", {
        text: speechText,
        speaker: "draco",
        encoding: "mp3",
      });
      if (!audio || typeof audio.getReader !== "function") {
        console.error("ATLAS TTS returned an unexpected audio payload.");
        return json({ error: "The speech service returned an invalid audio response." }, 502);
      }
      return new Response(audio, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-ATLAS-Voice": "draco",
        },
      });
    } catch (error) {
      console.error("ATLAS TTS inference failed:", error?.message || "unknown error");
      return json({ error: "ATLAS could not generate speech just now. Please try again." }, 503, { "Retry-After": "3" });
    }
  },
};
