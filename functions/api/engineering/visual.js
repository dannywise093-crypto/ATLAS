const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 3;
const MAX_PROMPT_LENGTH = 1800;
const buckets = new Map();

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}

function rateLimited(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    if (buckets.size > 4000) {
      for (const [key, value] of buckets) {
        if (now - value.start >= WINDOW_MS) buckets.delete(key);
      }
    }
    return false;
  }
  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) return true;
  bucket.count += 1;
  return false;
}

export async function onRequestPost({ request, env }) {
  if (!env.AI || typeof env.AI.run !== "function") {
    return json({ error: "Cloudflare Workers AI is not configured for Engineering Studio." }, 503);
  }
  if (rateLimited(request)) {
    return json({ error: "Image-generation limit reached. Please wait one minute." }, 429, { "Retry-After": "60" });
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (length > 8 * 1024) return json({ error: "The image prompt is too large." }, 413);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "A valid JSON body is required." }, 400); }

  if (!body || typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > MAX_PROMPT_LENGTH) {
    return json({ error: "Provide a visual prompt between 1 and 1,800 characters." }, 400);
  }

  try {
    const generated = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
      prompt: body.prompt.trim(),
      steps: 4
    });

    if (generated instanceof Response) {
      if (!generated.ok) return json({ error: "The image model could not complete this request." }, 502);
      return new Response(generated.body, {
        status: 200,
        headers: {
          "Content-Type": generated.headers.get("Content-Type") || "image/png",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
    }
    if (generated instanceof ReadableStream) {
      return new Response(generated, {
        status: 200,
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
      });
    }
    // Workers AI image models commonly return an object such as
    // { image: Uint8Array }, rather than returning the bytes directly.
    const image = generated && typeof generated === "object" && "image" in generated
      ? generated.image
      : generated;
    if (image instanceof Uint8Array || image instanceof ArrayBuffer) {
      return new Response(image, {
        status: 200,
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
      });
    }
    if (Array.isArray(image) && image.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
      return new Response(new Uint8Array(image), {
        status: 200,
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
      });
    }
    return json({ error: "The image model returned an unsupported response format." }, 502);
  } catch {
    return json({ error: "The image model is temporarily unavailable. Please retry later." }, 503, { "Retry-After": "5" });
  }
}

export async function onRequest({ request }) {
  return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
}
