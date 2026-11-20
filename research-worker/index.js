import { DurableObject } from "cloudflare:workers";
import { ResearchStorage } from "./storage.js";
import { handleCheckpointObjectRequest } from "./checkpoint-objects.js";
import { D1CheckpointIndex } from "./checkpoint-index.js";
import { drainCheckpointGarbage } from "./checkpoint-garbage-collector.js";
import { CheckpointCoordinator } from "./checkpoint-coordinator.js";
import { validStorageRequest } from "./storage-policy.js";
import { constantTimeEqual, extractBearerToken, isAllowedResearchRoute, missingRuntimeConfig, researchReadiness } from "./policy.js";

const CONTAINER_PORT = 8000;
const START_TIMEOUT_MS = 120_000;
const HEALTH_RETRY_MS = 1_000;
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
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
          NEXORA_RESEARCH_CHECKPOINT_BACKEND: this.env.NEXORA_RESEARCH_CHECKPOINT_BACKEND || "postgres",
          NEXORA_RESEARCH_STORAGE_URL: this.env.NEXORA_RESEARCH_PUBLIC_URL,
          NEXORA_RESEARCH_TENANT: this.env.NEXORA_RESEARCH_TENANT,
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

export class ResearchStorageObject extends ResearchStorage {}
export { CheckpointCoordinator };

export default {
  async fetch(request, env) {
    const supplied = extractBearerToken(request.headers.get("authorization"));
    const expected = env.NEXORA_RESEARCH_API_TOKEN;
    if (!expected || expected.length < 32 || !constantTimeEqual(supplied, expected)) {
      return json({ error: "Unauthorized." }, 401);
    }

    const url = new URL(request.url);
    if (url.pathname === "/internal/readiness" && request.method === "GET") {
      const readiness = researchReadiness(env);
      return json(readiness, readiness.ready ? 200 : 503);
    }
    if (url.pathname.startsWith("/internal/checkpoint-threads/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const tenant = parts[2];
      let threadId;
      try { threadId = decodeURIComponent(parts[3] || ""); } catch { threadId = ""; }
      if (parts.length !== 5 || parts[4] !== "delete" ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tenant || "") ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(threadId || "")) {
        return json({ error: "Invalid checkpoint thread route." }, 400);
      }
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (!env.RESEARCH_CHECKPOINTS_DB) return json({ error: "Checkpoint D1 database is not configured." }, 503);
      try {
        const result = await new D1CheckpointIndex(env.RESEARCH_CHECKPOINTS_DB).deleteThread({ tenantId: tenant, threadId });
        return json(result);
      } catch {
        return json({ error: "Checkpoint thread deletion failed." }, 500);
      }
    }
    if (url.pathname.startsWith("/internal/checkpoint-coordinator/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const tenant = parts[2];
      let threadId;
      try { threadId = decodeURIComponent(parts[3] || ""); } catch { threadId = ""; }
      const action = parts[4];
      const checkpointNs = url.searchParams.get("namespace") ?? "";
      if (parts.length !== 5 ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tenant || "") ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(threadId || "") ||
          !["acquire", "renew", "release", "publish", "get", "list", "get-thread", "put-writes", "list-writes"].includes(action) ||
          checkpointNs.length > 256 || /[\\u0000-\\u001f]/.test(checkpointNs)) {
        return json({ error: "Invalid checkpoint coordinator route or namespace." }, 400);
      }
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (!env.RESEARCH_CHECKPOINT_COORDINATOR) {
        return json({ error: "Checkpoint coordinator is not configured." }, 503);
      }
      try {
        const id = env.RESEARCH_CHECKPOINT_COORDINATOR.idFromName(
          JSON.stringify([tenant, threadId, checkpointNs])
        );
        const stub = env.RESEARCH_CHECKPOINT_COORDINATOR.get(id);
        const coordinatorUrl = new URL(request.url);
        coordinatorUrl.protocol = "https:";
        coordinatorUrl.hostname = "checkpoint-coordinator.internal";
        coordinatorUrl.pathname = "/" + action;
        coordinatorUrl.searchParams.set("tenant", tenant);
        coordinatorUrl.searchParams.set("thread", threadId);
        coordinatorUrl.searchParams.set("namespace", checkpointNs);
        return await stub.fetch(new Request(coordinatorUrl, request));
      } catch {
        return json({ error: "Checkpoint coordinator is unavailable." }, 503);
      }
    }
    if (url.pathname.startsWith("/internal/checkpoint-objects/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const tenant = parts[2];
      if (!tenant || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tenant)) {
        return json({ error: "Invalid checkpoint tenant." }, 400);
      }
      try {
        return await handleCheckpointObjectRequest(request, env, tenant);
      } catch {
        return json({ error: "Checkpoint object storage operation failed." }, 500);
      }
    }

    if (url.pathname.startsWith("/internal/storage/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const tenant = parts[4];
      if (!validStorageRequest(request.method, url.pathname.slice("/internal/storage".length))) {
        return json({ error: "Storage route not found or method not allowed." }, 404);
      }
      if (!tenant || !env.RESEARCH_STORAGE) {
        return json({ error: "Research storage is unavailable." }, 503);
      }
      try {
        const id = env.RESEARCH_STORAGE.idFromName(tenant);
        const stub = env.RESEARCH_STORAGE.get(id);
        const storageUrl = new URL(request.url);
        storageUrl.pathname = url.pathname.slice("/internal/storage".length);
        return await stub.fetch(new Request(storageUrl, request));
      } catch {
        return json({ error: "Research storage is unavailable." }, 503);
      }
    }

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
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(drainCheckpointGarbage(env));
  },
};

export const researchWorkerInternals = { isAllowedResearchRoute, missingRuntimeConfig, drainCheckpointGarbage };
