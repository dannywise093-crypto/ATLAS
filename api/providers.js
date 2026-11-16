import { checkMethod, sendJson } from "./_gateway.js";

export default async function handler(req, res) {
  if (!checkMethod(req, res, "GET")) return;
  return sendJson(res, 200, {
    defaultProvider: "atlas",
    providers: {
      atlas: { configured: Boolean(process.env.ATLAS_GATEWAY_URL && process.env.ATLAS_GATEWAY_TOKEN), label: "ATLAS Native AI" },
      nvidia: { configured: Boolean(process.env.NVIDIA_API_KEY), label: "NVIDIA API Catalog" },
      githubCopilot: { configured: Boolean(process.env.ATLAS_GITHUB_COPILOT_SERVICE_URL && process.env.ATLAS_GITHUB_COPILOT_SERVICE_TOKEN), label: "GitHub Copilot SDK" },
      microsoftCopilotStudio: { configured: Boolean(process.env.MICROSOFT_COPILOT_STUDIO_DIRECT_LINE_SECRET && process.env.MICROSOFT_COPILOT_STUDIO_BOT_ID), label: "Microsoft Copilot Studio" },
      microsoft365Copilot: { configured: Boolean(process.env.MICROSOFT_365_AGENT_URL && process.env.MICROSOFT_365_AGENT_TOKEN), label: "Microsoft 365 Copilot agent" }
    }
  });
}
