import { proxyTts } from "./_gateway.js";

export async function onRequestGet({ request, env }) {
  const upstreamRequest = new Request(new URL("/api/tts", request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "ATLAS voice test." })
  });
  const response = await proxyTts(upstreamRequest, env);
  if (!response.ok) {
    const detail = await response.text();
    return new Response(JSON.stringify({ ok: false, status: response.status, detail }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
  const audio = await response.arrayBuffer();
  return new Response(JSON.stringify({
    ok: audio.byteLength > 100,
    status: response.status,
    contentType: response.headers.get("Content-Type"),
    bytes: audio.byteLength,
    voice: response.headers.get("X-ATLAS-Voice") || "draco",
    message: "Temporary end-to-end preview speech check."
  }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
