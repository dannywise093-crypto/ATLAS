const rateBuckets = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const MAX_BODY_BYTES = 64 * 1024;

export function sendJson(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function checkMethod(req, res, method) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== method) {
    res.setHeader("Allow", method);
    sendJson(res, 405, { error: "Method not allowed." });
    return false;
  }
  return true;
}

export function checkRateLimit(req, res) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
  } else if (bucket.count >= MAX_REQUESTS_PER_WINDOW) {
    res.setHeader("Retry-After", String(Math.ceil((WINDOW_MS - (now - bucket.start)) / 1000)));
    sendJson(res, 429, { error: "Too many requests. Please wait before trying again." });
    return false;
  } else {
    bucket.count += 1;
  }
  if (rateBuckets.size > 5000) {
    for (const [key, value] of rateBuckets) {
      if (now - value.start >= WINDOW_MS) rateBuckets.delete(key);
    }
  }
  return true;
}

export function validateBody(req) {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return "A JSON request body is required.";
  }
  const raw = JSON.stringify(req.body);
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return "Request body is too large.";
  return null;
}

export async function callGateway(path, body) {
  const base = (process.env.ATLAS_GATEWAY_URL || "").replace(/\/$/, "");
  const token = process.env.ATLAS_GATEWAY_TOKEN;
  if (!base || !token) {
    return { status: 503, body: { error: "ATLAS backend is not configured. Add ATLAS_GATEWAY_URL and ATLAS_GATEWAY_TOKEN to the Vercel server environment." } };
  }

  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Authorization: `Bearer ${token}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(112_000),
    });
  } catch {
    return { status: 502, body: { error: "ATLAS backend could not be reached before the request deadline. Please retry." , retryable: true } };
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      status: response.status,
      body: {
        error: typeof payload.error === "string"
          ? payload.error
          : typeof payload.detail === "string" ? payload.detail : "ATLAS backend request failed.",
        ...(payload.retryable === true ? { retryable: true } : {}),
        ...(Array.isArray(payload.diagnostics) ? { diagnostics: payload.diagnostics } : {}),
      },
    };
  }
  return { status: 200, body: payload };
}
