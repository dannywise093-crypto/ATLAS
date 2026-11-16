import { checkMethod, checkRateLimit, sendJson, validateBody } from "./_gateway.js";

const NVIDIA_CHAT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_MODEL = "meta/llama-3.3-70b-instruct";

export default async function handler(req, res) {
  if (!checkMethod(req, res, "POST")) return;
  if (!checkRateLimit(req, res)) return;
  const validationError = validateBody(req);
  if (validationError) return sendJson(res, 400, { error: validationError });
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return sendJson(res, 503, { error: "NVIDIA hosted inference is not configured. Add NVIDIA_API_KEY to the Vercel server environment." });
  const { messages, model } = req.body || {};
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 24) {
    return sendJson(res, 400, { error: "Provide between 1 and 24 messages." });
  }
  const safeMessages = [];
  for (const item of messages) {
    if (!item || !["user", "assistant"].includes(item.role) ||
        typeof item.content !== "string" || !item.content.trim() || item.content.length > 12000) {
      return sendJson(res, 400, { error: "A message has an invalid role or content." });
    }
    safeMessages.push({ role: item.role, content: item.content });
  }
  if (safeMessages[safeMessages.length - 1].role !== "user") {
    return sendJson(res, 400, { error: "The latest message must be from the user." });
  }
  const selectedModel = typeof model === "string" && /^[a-zA-Z0-9._/-]{1,120}$/.test(model)
    ? model : DEFAULT_MODEL;
  let upstream;
  try {
    upstream = await fetch(NVIDIA_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ model: selectedModel, messages: safeMessages, temperature: 0.3, max_tokens: 4096, stream: false }),
      signal: AbortSignal.timeout(110_000),
    });
  } catch {
    return sendJson(res, 502, { error: "NVIDIA hosted inference could not be reached. Please retry.", retryable: true });
  }
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const message = typeof payload?.detail === "string" ? payload.detail :
      typeof payload?.error?.message === "string" ? payload.error.message : "NVIDIA inference request failed.";
    return sendJson(res, upstream.status === 401 || upstream.status === 403 ? 503 : upstream.status, { error: message });
  }
  const answer = payload?.choices?.[0]?.message?.content;
  if (typeof answer !== "string" || !answer.trim()) {
    return sendJson(res, 502, { error: "NVIDIA returned an empty response.", retryable: true });
  }
  return sendJson(res, 200, { answer: answer.trim(), provider: "NVIDIA API Catalog", model: selectedModel });
}
