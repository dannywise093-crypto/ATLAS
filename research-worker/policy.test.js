import test from "node:test";
import assert from "node:assert/strict";
import { constantTimeEqual, extractBearerToken, isAllowedResearchRoute, missingRuntimeConfig, researchReadiness } from "./policy.js";

test("research Worker parses bearer tokens using whitespace and case-insensitive scheme matching", () => {
  assert.equal(extractBearerToken("Bearer secret-value"), "secret-value");
  assert.equal(extractBearerToken("bearer\tsecret-value"), "secret-value");
  assert.equal(extractBearerToken("Basic secret-value"), "");
  assert.equal(extractBearerToken(null), "");
});

test("research Worker compares service tokens without accepting mismatches", () => {
  assert.equal(constantTimeEqual("same-secret-value", "same-secret-value"), true);
  assert.equal(constantTimeEqual("same-secret-value", "other-secret-value"), false);
  assert.equal(constantTimeEqual("short", "longer"), false);
  assert.equal(constantTimeEqual(undefined, "secret"), false);
});

test("research Worker exposes only approved async API routes", () => {
  assert.equal(isAllowedResearchRoute("/health", "GET"), true);
  assert.equal(isAllowedResearchRoute("/health", "POST"), false);
  assert.equal(isAllowedResearchRoute("/v1/jobs/async/agents", "GET"), true);
  assert.equal(isAllowedResearchRoute("/v1/jobs/async/submit", "POST"), true);
  assert.equal(isAllowedResearchRoute("/v1/jobs/async/job/job-123/stream", "GET"), true);
  assert.equal(isAllowedResearchRoute("/v1/jobs/async/job/job-123/report/edit", "POST"), true);
  assert.equal(isAllowedResearchRoute("/v1/jobs/async/job/job-123/report/edit", "GET"), false);
  assert.equal(isAllowedResearchRoute("/admin/secrets", "GET"), false);
  assert.equal(isAllowedResearchRoute("/v1/jobs/async/job/../secrets", "GET"), false);
});

test("research Worker requires every provider, service, and durable storage setting", () => {
  const required = [
    "NVIDIA_API_KEY",
    "TAVILY_API_KEY",
    "EXA_API_KEY",
    "NIMBLE_API_KEY",
    "YDC_API_KEY",
    "SERPER_API_KEY",
    "NEXORA_RESEARCH_API_TOKEN",
    "NAT_JOB_STORE_DB_URL",
    "DEEP_RESEARCHER_CHECKPOINT_DB"
  ];
  assert.deepEqual(missingRuntimeConfig({}), required);
  assert.deepEqual(missingRuntimeConfig(Object.fromEntries(required.map((name) => [name, "configured"]))), []);
  assert.deepEqual(missingRuntimeConfig({ ...Object.fromEntries(required.map((name) => [name, "configured"])), EXA_API_KEY: " " }), ["EXA_API_KEY"]);
});

test("research readiness reports configuration booleans without exposing secret values", () => {
  const names = ["NVIDIA_API_KEY", "TAVILY_API_KEY", "EXA_API_KEY", "NIMBLE_API_KEY", "YDC_API_KEY", "SERPER_API_KEY", "NEXORA_RESEARCH_API_TOKEN", "NAT_JOB_STORE_DB_URL", "DEEP_RESEARCHER_CHECKPOINT_DB"];
  const env = Object.fromEntries(names.map((name) => [name, "configured-secret-value"]));
  env.RESEARCH_STORAGE = {};
  env.RESEARCH_CONTAINER = {};
  env.NEXORA_RESEARCH_EVENT_STORE = "cloudflare";
  const result = researchReadiness(env);
  assert.equal(result.ready, true);
  assert.equal(result.providersConfigured, true);
  assert.equal(result.serviceTokenConfigured, true);
  assert.equal(result.eventStoreBackend, "cloudflare");
  assert.equal(JSON.stringify(result).includes("configured-secret-value"), false);
});

test("research readiness blocks when provider or durable bindings are absent", () => {
  const result = researchReadiness({});
  assert.equal(result.ready, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.providersConfigured, false);
  assert.equal(result.storageBindingConfigured, false);
  assert.equal(result.containerBindingConfigured, false);
});
