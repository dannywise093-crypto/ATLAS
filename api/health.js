import { callGateway, checkMethod, sendJson } from "./_gateway.js";

export default async function handler(req, res) {
  if (!checkMethod(req, res, "GET")) return;
  const result = await callGateway("/api/health");
  return sendJson(res, result.status, result.body);
}
