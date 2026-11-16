import { proxyTts } from "./_gateway.js";

export async function onRequestPost({ request, env }) {
  return proxyTts(request, env);
}

export async function onRequest({ request }) {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { Allow: "POST", "Content-Type": "application/json" }
  });
}
