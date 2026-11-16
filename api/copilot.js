import { callGateway, checkMethod, checkRateLimit, sendJson, validateBody } from "./_gateway.js";

export default async function handler(req, res) {
  if (!checkMethod(req, res, "POST")) return;
  if (!checkRateLimit(req, res)) return;
  const validationError = validateBody(req);
  if (validationError) return sendJson(res, 400, { error: validationError });

  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 24) {
    return sendJson(res, 400, { error: "Provide between 1 and 24 conversation messages." });
  }
  for (const message of messages) {
    if (!message || !["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string" || !message.content.trim() ||
        message.content.length > 12000) {
      return sendJson(res, 400, { error: "A conversation message has an invalid role or content." });
    }
  }
  if (messages[messages.length - 1].role !== "user") {
    return sendJson(res, 400, { error: "The latest conversation message must be from the user." });
  }

  const result = await callGateway("/api/copilot", { messages });
  return sendJson(res, result.status, result.body);
}
