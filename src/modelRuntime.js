// ATLAS model gateway client.
// The browser never receives an upstream model-provider secret. The backend
// owns provider credentials and forwards requests to an OpenAI-compatible
// inference server (for example llama.cpp, vLLM, or a hosted open-weight model).
const API_BASE = String(import.meta.env.VITE_ATLAS_API_URL || "").replace(/\/$/, "");

export function getNeuralRuntimeStatus() {
  return {
    id: "atlas-model-gateway",
    label: "ATLAS model gateway",
    available: true,
    reason: "The app is configured to call the ATLAS server gateway. Model availability is verified by the server health endpoint.",
  };
}

export async function checkAtlasBackend(signal) {
  const response = await fetch(`${API_BASE}/api/health`, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`ATLAS service health check failed (HTTP ${response.status}).`);
  return response.json();
}

export async function generateAtlasResponse(history, signal) {
  const messages = history
    .filter((item) => item && (item.role === "user" || item.role === "atlas" || item.role === "assistant"))
    .slice(-24)
    .map((item) => ({ role: item.role === "atlas" ? "assistant" : item.role, content: String(item.text || "").slice(0, 12000) }));

  const response = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || `ATLAS model service returned HTTP ${response.status}.`);
  }
  const answer = payload.answer;
  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("The configured model returned an empty response.");
  }
  return answer.trim();
}
