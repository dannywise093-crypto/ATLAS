import { proxy } from "./_gateway.js";

// NVIDIA is selected by the Cloudflare Worker when its private NVIDIA_API_KEY
// secret is configured. The browser and Pages Function never receive that key.
export async function onRequestPost({ request, env }) {
  return proxy(request, env, "/api/chat", "POST");
}

export async function onRequest() {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: { Allow: "POST", "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
