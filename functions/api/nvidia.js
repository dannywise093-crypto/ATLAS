import { proxy } from "./_gateway.js";

// Compatibility endpoint: NVIDIA and native ATLAS requests now share the
// same authenticated gateway, skill router, provider selection, and fallback.
export async function onRequestPost({ request, env }) {
  return proxy(request, env, "/api/chat", "POST");
}
