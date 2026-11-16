export async function onRequestGet() {
  return new Response(JSON.stringify({ providers: { nvidia: { configured: false } } }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}