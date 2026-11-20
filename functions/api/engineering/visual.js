const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 3;
const MAX_PROMPT_LENGTH = 1800;
const buckets = new Map();

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}

function rateLimited(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    if (buckets.size > 4000) for (const [key, value] of buckets) if (now - value.start >= WINDOW_MS) buckets.delete(key);
    return false;
  }
  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) return true;
  bucket.count += 1;
  return false;
}

function decodeBase64(value) {
  const clean = value.replace(/^data:image\\/[a-zA-Z0-9.+-]+;base64,/, "").replace(/\\s/g, "");
  if (!clean || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  try {
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch { return null; }
}

async function imageBytes(generated) {
  let image = generated;
  if (image && typeof image === "object" && "image" in image) image = image.image;
  if (image instanceof Response) {
    if (!image.ok) throw new Error("Model response was not successful");
    return new Uint8Array(await image.arrayBuffer());
  }
  if (image instanceof Blob) return new Uint8Array(await image.arrayBuffer());
  if (image instanceof ArrayBuffer) return new Uint8Array(image);
  if (ArrayBuffer.isView(image)) return new Uint8Array(image.buffer, image.byteOffset, image.byteLength);
  if (Array.isArray(image) && image.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) return new Uint8Array(image);
  if (typeof image === "string") {
    const decoded = decodeBase64(image);
    if (decoded) return decoded;
  }
  if (image && typeof image === "object" && Array.isArray(image.data) &&
      image.data.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) return new Uint8Array(image.data);
  throw new Error("Unsupported image payload type: " + (image === null ? "null" : typeof image));
}

export async function onRequestPost({ request, env }) {
  if (!env.AI || typeof env.AI.run !== "function") return json({ error: "Cloudflare Workers AI is not configured for Engineering Studio." }, 503);
  if (rateLimited(request)) return json({ error: "Image-generation limit reached. Please wait one minute." }, 429, { "Retry-After": "60" });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 8 * 1024) return json({ error: "The image prompt is too large." }, 413);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "A valid JSON body is required." }, 400); }
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > MAX_PROMPT_LENGTH) {
    return json({ error: "Provide a visual prompt between 1 and 1,800 characters." }, 400);
  }

  try {
    const generated = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: body.prompt.trim(), steps: 4 });
    const bytes = await imageBytes(generated);
    if (!bytes.byteLength) return json({ error: "The image model returned an empty image." }, 502);
    return new Response(bytes, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    console.error("Engineering visual generation failed:", error);
    return json({ error: "The image model could not return a usable image. Please retry." }, 502);
  }
}

export async function onRequest({ request }) {
  return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
}
