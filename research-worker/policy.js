export function extractBearerToken(header) {
  if (typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function isAllowedResearchRoute(pathname, method) {
  if (pathname === "/health") return method === "GET";
  const prefix = "/v1/jobs/async/";
  if (!pathname.startsWith(prefix)) return false;
  const route = pathname.slice(prefix.length).replace(/\/$/, "");
  if (route === "agents") return method === "GET";
  if (route === "submit") return method === "POST";
  const match = route.match(/^job\/[A-Za-z0-9_-]{1,80}(?:\/(stream(?:\/[0-9]+)?|cancel|state|report|report\/edit))?$/);
  if (!match) return false;
  const action = match[1] || "";
  if (action === "cancel" || action === "report/edit") return method === "POST";
  return method === "GET";
}

export function researchReadiness(env) {
  const missing = missingRuntimeConfig(env);
  const providerNames = [
    "NVIDIA_API_KEY", "TAVILY_API_KEY", "EXA_API_KEY",
    "NIMBLE_API_KEY", "YDC_API_KEY", "SERPER_API_KEY",
  ];
  const providersConfigured = providerNames.every((name) =>
    typeof env[name] === "string" && env[name].trim().length > 0
  );
  const serviceTokenConfigured = typeof env.NEXORA_RESEARCH_API_TOKEN === "string" && env.NEXORA_RESEARCH_API_TOKEN.trim().length >= 32;
  const sqlJobStoreConfigured = typeof env.NAT_JOB_STORE_DB_URL === "string" && env.NAT_JOB_STORE_DB_URL.trim().length > 0;
  const checkpointStoreConfigured = typeof env.DEEP_RESEARCHER_CHECKPOINT_DB === "string" && env.DEEP_RESEARCHER_CHECKPOINT_DB.trim().length > 0;
  const storageBindingConfigured = Boolean(env.RESEARCH_STORAGE);
  const containerBindingConfigured = Boolean(env.RESEARCH_CONTAINER);
  const checkpointBackend = typeof env.NEXORA_RESEARCH_CHECKPOINT_BACKEND === "string"
    ? env.NEXORA_RESEARCH_CHECKPOINT_BACKEND.trim().toLowerCase() || "postgres"
    : "postgres";
  const checkpointBackendSupported = checkpointBackend === "postgres" || checkpointBackend === "cloudflare";
  const checkpointMigrationMissing = checkpointBackend === "cloudflare"
    ? [
        ...(!env.RESEARCH_CHECKPOINTS_DB ? ["RESEARCH_CHECKPOINTS_DB (D1)"] : []),
        ...(!env.RESEARCH_CHECKPOINTS_BUCKET ? ["RESEARCH_CHECKPOINTS_BUCKET (R2)"] : []),
        ...(!env.RESEARCH_CHECKPOINT_COORDINATOR ? ["RESEARCH_CHECKPOINT_COORDINATOR (Durable Object)"] : []),
        "Cloudflare LangGraph checkpoint saver implementation and conformance tests",
      ]
    : [];
  const checkpointBackendReady = checkpointBackend === "postgres" && checkpointStoreConfigured;
  const checkpointMigrationReady = checkpointBackend === "cloudflare" &&
    checkpointMigrationMissing.length === 0;
  const checkpointReady = checkpointBackendReady || checkpointMigrationReady;
  const ready = missing.length === 0 && storageBindingConfigured && containerBindingConfigured &&
    checkpointBackendSupported && checkpointReady;
  return {
    ready,
    status: ready ? "configured" : "blocked",
    providersConfigured, serviceTokenConfigured, sqlJobStoreConfigured, checkpointStoreConfigured,
    storageBindingConfigured, containerBindingConfigured,
    eventStoreBackend: env.NEXORA_RESEARCH_EVENT_STORE === "cloudflare" ? "cloudflare" : "sql",
    checkpointBackend,
    checkpointBackendSupported,
    checkpointReady,
    checkpointMigrationReady,
    checkpointMigrationMissing,
    missingConfiguration: missing,
  };
}

export function missingRuntimeConfig(env) {
  const missing = [];
  for (const name of [
    "NVIDIA_API_KEY",
    "TAVILY_API_KEY",
    "EXA_API_KEY",
    "NIMBLE_API_KEY",
    "YDC_API_KEY",
    "SERPER_API_KEY",
    "NEXORA_RESEARCH_API_TOKEN",
    "NAT_JOB_STORE_DB_URL",
    "DEEP_RESEARCHER_CHECKPOINT_DB",
  ]) {
    if (typeof env[name] !== "string" || !env[name].trim()) missing.push(name);
  }
  return missing;
}
