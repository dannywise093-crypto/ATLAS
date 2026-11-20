import { proxyVisualGeneration } from "../_gateway.js";

export async function onRequestPost({ request, env }) {
  return proxyVisualGeneration(request, env);
}

export async function onRequest() {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { Allow: "POST", "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
