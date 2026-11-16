import { proxyTts } from "./_gateway.js";

export async function onRequestGet({ request, env }) {
  const synthetic = new Request(new URL("/api/tts", request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "ATLAS voice test." })
  });
  const response = await proxyTts(synthetic, env);
  if (!response.ok) {
    return new Response(JSON.stringify({ ok: false, status: response.status, detail: await response.text() }), {
      status: 502, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
  const bytes = await response.arrayBuffer();
  return new Response(JSON.stringify({
    ok: bytes.byteLength > 100,
    bytes: bytes.byteLength,
    contentType: response.headers.get("Content-Type"),
    voice: response.headers.get("X-ATLAS-Voice") || "draco"
  }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
