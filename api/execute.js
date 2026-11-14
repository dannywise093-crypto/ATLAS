import { callGateway, checkMethod, checkRateLimit, sendJson, validateBody } from "./_gateway.js";

export default async function handler(req, res) {
  if (!checkMethod(req, res, "POST")) return;
  if (!checkRateLimit(req, res)) return;
  const validationError = validateBody(req);
  if (validationError) return sendJson(res, 400, { error: validationError });

  const { code, auto_repair = true } = req.body;
  if (typeof code !== "string" || !code.trim() || code.length > 20000) {
    return sendJson(res, 400, { error: "Provide Python source code between 1 and 20,000 characters." });
  }
  if (typeof auto_repair !== "boolean") {
    return sendJson(res, 400, { error: "auto_repair must be a boolean." });
  }
  const result = await callGateway("/api/execute", { code, auto_repair });
  return sendJson(res, result.status, result.body);
}
