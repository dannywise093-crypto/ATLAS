import { DurableObject } from "cloudflare:workers";

const API_PREFIX = "/v1/jobs/async/";
const CONTAINER_PORT = 8000;
const START_TIMEOUT_MS = 120_000;
const HEALTH_RETRY_MS = 1_000;
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function isAllowedResearchRoute(pathname, method) {
  if (pathname === "/health") return method === "GET";
  if (!pathname.startsWith(API_PREFIX)) return false;
  const route = pathname.slice(API_PREFIX.length).replace(/\/$/, "");
  if (route === "agents") return method === "GET";
  if (route === "submit") return method === "POST";
  const match = route.match(/^job\/[A-Za-z0-9_-]{1,80}(?:\/(stream(?:\/[0-9]+)?|cancel|state|report|report\/edit))?$/);
  if (!match) return false;
  const action = match[1] || "";
  if (action === "cancel" || action === "report/edit") return method === "POST";
  return method === "GET";
}

function missingRuntimeConfig(env) {
  const missing = [];
  for (const name of [
    "NVIDIA_API_KEY",
    "TAVILY_API_KEY",
    "EXA_API_KEY",
    "NIMBLE_API_KEY",
    "YDC_API_KEY",
    "SERPER_API_KEY",
    "NEXORA_RESEARCH_API_TOKEN",
  ]) {
    if (typeof env[name] !== "string" || !env[name].trim()) missing.push(name);
  }
  // NVIDIA's async job store and LangGraph checkpoints must survive container
  // restarts. Local SQLite files on a Container's ephemeral disk are not valid
  // production persistence. Fail closed until a durable adapter is configured.
  for (const name of ["NAT_JOB_STORE_DB_URL", "DEEP_RESEARCHER_CHECKPOINT_DB"]) {
    if (typeof env[name] !== "string" || !env[name].trim()) missing.push(name);
  }
  return missing;
}

export class ResearchContainer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.starting = undefined;
  }

  async fetch(request) {
    this.starting ??= this.startAndWaitForHealth().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    const url = new URL(request.url);
    url.protocol = "http:";
    url.hostname = "container";
    url.port = String(CONTAINER_PORT);
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return this.ctx.container.getTcpPort(CONTAINER_PORT).fetch(forwarded);
  }

  async startAndWaitForHealth() {
    const container = this.ctx.container;
    if (!container.running) {
      const missing = missingRuntimeConfig(this.env);
      if (missing.length) {
        throw new Error("Research runtime is missing required configuration: " + missing.join(", "));
      }

      container.start({
        image: container.images.base,
        instance: { vcpu: 4, memory_mib: 8192, disk_mb: 20000 },
        enableInternet: true,
        env: {
          APP_ENV: "production",
          HOST: "0.0.0.0",
          PORT: String(CONTAINER_PORT),
          CONFIG_FILE: "/app/configs/config_nexora_all_providers.yml",
          REQUIRE_AUTH: "true",
          DEEP_RESEARCHER_ENABLE_DEBUG: "false",
          PYTHONUNBUFFERED: "1",
          NVIDIA_API_KEY: this.env.NVIDIA_API_KEY,
          TAVILY_API_KEY: this.env.TAVILY_API_KEY,
          EXA_API_KEY: this.env.EXA_API_KEY,
          NIMBLE_API_KEY: this.env.NIMBLE_API_KEY,
          YDC_API_KEY: this.env.YDC_API_KEY,
          SERPER_API_KEY: this.env.SERPER_API_KEY,
          NEXORA_RESEARCH_API_TOKEN: this.env.NEXORA_RESEARCH_API_TOKEN,
          NAT_JOB_STORE_DB_URL: this.env.NAT_JOB_STORE_DB_URL,
          DEEP_RESEARCHER_CHECKPOINT_DB: this.env.DEEP_RESEARCHER_CHECKPOINT_DB,
        },
      });
    }

    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    const port = container.getTcpPort(CONTAINER_PORT);
    const deadline = Date.now() + START_TIMEOUT_MS;
    let lastError;

    while (Date.now() < deadline) {
      try {
        const response = await port.fetch("http://container:8000/health", {
          signal: AbortSignal.timeout(3_000),
        });
        if (response.ok) {
          await response.body?.cancel();
          return;
        }
        lastError = new Error("Research API health check returned " + response.status);
        await response.body?.cancel();
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_RETRY_MS));
    }

    throw new Error("NVIDIA Deep Researcher container did not become healthy", { cause: lastError });
  }
}

export default {
  async fetch(request, env) {
    const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const expected = env.NEXORA_RESEARCH_API_TOKEN;
    if (!expected || expected.length < 32 || !constantTimeEqual(supplied, expected)) {
      return json({ error: "Unauthorized." }, 401);
    }

    const url = new URL(request.url);
    if (!isAllowedResearchRoute(url.pathname, request.method)) {
      return json({ error: "Research route not found or method not allowed." }, 404);
    }

    if (request.method === "POST") {
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > 40 * 1024) return json({ error: "Research request body is too large." }, 413);
    }

    const missing = missingRuntimeConfig(env);
    if (missing.length) {
      return json({
        error: "NVIDIA Deep Researcher is not ready. Required private secrets or durable persistence settings are missing.",
        code: "research_runtime_not_configured",
        missingConfiguration: missing,
      }, 503);
    }

    try {
      const stub = env.RESEARCH_CONTAINER.getByName("nexora-deep-researcher");
      return await stub.fetch(request);
    } catch {
      return json({
        error: "The NVIDIA Deep Researcher container could not be started or reached.",
        code: "research_container_unavailable",
        retryable: true,
      }, 503, { "retry-after": "10" });
    }
  },
};

export const researchWorkerInternals = { isAllowedResearchRoute, missingRuntimeConfig };
