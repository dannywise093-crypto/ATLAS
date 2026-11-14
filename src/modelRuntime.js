// ATLAS model gateway client.
// Production requests use same-origin Vercel serverless routes. The gateway
// token and model-provider credentials remain server-side and never enter VITE_*.
const API_BASE = String(import.meta.env.VITE_ATLAS_API_URL || "").replace(/\/$/, "");

export function getNeuralRuntimeStatus() {
  return {
    id: "atlas-model-gateway",
    label: "ATLAS model gateway",
    available: false,
    reason: "The application proxy is ready; a deployed gateway and configured inference model are still required.",
  };
}

async function requestJson(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { Accept: "application/json", ...(options.headers || {}) },
    });
  } catch {
    throw new Error("The ATLAS application server could not be reached. Check the deployment and try again.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.detail === "string"
          ? payload.detail
          : `ATLAS service returned HTTP ${response.status}.`
    );
  }
  return payload;
}

export async function checkAtlasBackend(signal) {
  return requestJson("/api/health", { signal });
}

export async function generateAtlasResponse(history, signal) {
  const messages = history
    .filter((item) => item && (item.role === "user" || item.role === "atlas" || item.role === "assistant"))
    .slice(-24)
    .map((item) => ({
      role: item.role === "atlas" ? "assistant" : item.role,
      content: String(item.text || "").trim().slice(0, 12000),
    }))
    .filter((item) => item.content.length > 0);

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    throw new Error("Send a message before requesting an ATLAS response.");
  }

  const payload = await requestJson("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (typeof payload.answer !== "string" || !payload.answer.trim()) {
    throw new Error("The configured model returned an empty response.");
  }
  return payload.answer.trim();
}
