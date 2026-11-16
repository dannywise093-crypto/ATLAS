export async function onRequestGet({ env }) {
  const nvidiaConfigured = Boolean(env.NVIDIA_API_KEY);
  return new Response(JSON.stringify({
    defaultProvider: "atlas",
    providers: {
      atlas: { configured: Boolean(env.ATLAS_GATEWAY_TOKEN), label: "ATLAS Native AI" },
      nvidia: {
        configured: nvidiaConfigured,
        label: "NVIDIA API Catalog",
        models: ["meta/llama-3.3-70b-instruct"],
        reason: nvidiaConfigured ? null : "Add NVIDIA_API_KEY as a Cloudflare Pages secret to enable NVIDIA hosted inference."
      }
    }
  }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
