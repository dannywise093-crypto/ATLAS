// Vercel Serverless adapter for the existing private Cloudflare model gateway.
// Cloudflare Pages uses functions/api/*; Vercel does not execute that directory,
// so this catch-all provides the same-origin /api/* routes for Vercel deployments.
// Secrets stay server-side and are never exposed through VITE_* variables.

const DEFAULT_GATEWAY_URL = "https://atlas-model-gateway.dannywise093.workers.dev";
const MAX_BODY_BYTES = 9 * 1024 * 1024;

const ROUTES = {
  health: { method: "GET", upstream: "/api/health" },
  providers: { method: "GET", upstream: "/api/providers" },
  skills: { method: "GET", upstream: "/api/skills" },
  chat: { method: "POST", upstream: "/api/chat" },
  copilot: { method: "POST", upstream: "/api/copilot" },
  nvidia: { method: "POST", upstream: "/api/chat" },
  transcribe: { method: "POST", upstream: "/api/transcribe" },
  tts: { method: "POST", upstream: "/api/tts" },
};

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

async function readRequestBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (value !== undefined && value !== null) res.setHeader(name, value);
  }
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  const routeName = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const route = ROUTES[routeName];

  if (!route) return sendJson(res, 404, { error: "API route not found." });
  if (req.method !== route.method) {
    return sendJson(res, 405, { error: "Method not allowed." }, { Allow: route.method });
  }

  const gatewayUrl = String(process.env.ATLAS_GATEWAY_URL || DEFAULT_GATEWAY_URL).replace(/\/+$/, "");
  const gatewayToken = process.env.ATLAS_GATEWAY_TOKEN;
  if (!gatewayToken) {
    return sendJson(res, 503, { error: "The server-side ATLAS gateway token is not configured." });
  }

  try {
    const headers = new Headers({
      Accept: req.headers.accept || "application/json",
      Authorization: `Bearer ${gatewayToken}`,
    });
    const contentType = req.headers["content-type"];
    if (contentType) headers.set("Content-Type", contentType);

    const body = route.method === "POST" ? await readRequestBody(req) : undefined;
    const upstream = await fetch(`${gatewayUrl}${route.upstream}`, {
      method: route.method,
      headers,
      ...(body && body.length ? { body } : {}),
    });

    const responseBody = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) res.setHeader("Retry-After", retryAfter);
    res.end(responseBody);
  } catch (error) {
    if (res.headersSent) return res.end();
    const status = Number(error?.statusCode) || 502;
    sendJson(res, status, {
      error: status === 413
        ? "Request body is too large."
        : "The ATLAS Cloudflare model gateway could not be reached. Please retry.",
      retryable: status !== 413,
    });
  }
}
