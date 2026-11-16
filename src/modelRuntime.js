// ATLAS model gateway client.
// Production requests use same-origin Cloudflare Pages Functions.
// Gateway and NVIDIA credentials remain server-side and never enter VITE_*.
const API_BASE = String(import.meta.env.VITE_ATLAS_API_URL || "").replace(/\/$/, "");

export function getNeuralRuntimeStatus() {
  return {
    id: "atlas-cloudflare-workers-ai",
    label: "Cloudflare Workers AI · GLM-4.7-Flash",
    available: false,
    reason: "Checking the secured ATLAS inference gateway.",
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

function appendSkillUsageNotice(answer) {
  // Skill routing is internal implementation detail; expose it only when the user asks.
  return answer;
}

export async function generateAtlasResponse(history, signal, options = {}) {
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
    body: JSON.stringify({ messages, voiceMode: options.voiceMode === true }),
    signal,
  });
  if (typeof payload.answer !== "string" || !payload.answer.trim()) {
    throw new Error("The configured model returned an empty response.");
  }
  return appendSkillUsageNotice(payload.answer.trim(), payload);
}

export async function generateAtlasCopilotResponse(history, signal) {
  const messages = history
    .filter((item) => item && (item.role === "user" || item.role === "atlas" || item.role === "assistant"))
    .slice(-24)
    .map((item) => ({
      role: item.role === "atlas" ? "assistant" : item.role,
      content: String(item.text || "").trim().slice(0, 12000),
    }))
    .filter((item) => item.content.length > 0);

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    throw new Error("Send a coding question before requesting ATLAS Copilot.");
  }

  const payload = await requestJson("/api/copilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });
  if (typeof payload.answer !== "string" || !payload.answer.trim()) {
    throw new Error("ATLAS Copilot returned an empty response.");
  }
  return appendSkillUsageNotice(payload.answer.trim(), payload);
}

export async function generateProviderResponse(provider, history, signal, options = {}) {
  if (provider === "atlas") return generateAtlasResponse(history, signal, options);
  if (provider !== "nvidia") throw new Error("This provider adapter is not available in this ATLAS build.");
  const messages = history
    .filter((item) => item && (item.role === "user" || item.role === "atlas" || item.role === "assistant"))
    .slice(-24)
    .map((item) => ({ role: item.role === "atlas" ? "assistant" : item.role, content: String(item.text || "").trim().slice(0, 12000) }))
    .filter((item) => item.content.length > 0);
  if (!messages.length || messages[messages.length - 1].role !== "user") throw new Error("Send a message before requesting a response.");
  const payload = await requestJson("/api/nvidia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, voiceMode: options.voiceMode === true }), signal });
  if (typeof payload.answer !== "string" || !payload.answer.trim()) throw new Error("NVIDIA returned an empty response.");
  return appendSkillUsageNotice(payload.answer.trim(), payload);
}
