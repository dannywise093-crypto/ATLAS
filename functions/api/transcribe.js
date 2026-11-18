import { proxyTranscription } from "./_gateway.js";

export async function onRequestPost({ request, env }) {
  return proxyTranscription(request, env);
}

export async function onRequest({ request }) {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { Allow: "POST", "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
