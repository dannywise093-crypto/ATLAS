import test from "node:test";
import assert from "node:assert/strict";
import { onRequest, researchProxyInternals } from "./research/[[path]].js";

test("research proxy only exposes the approved API routes", () => {
  const { allowedRoute } = researchProxyInternals;
  assert.equal(allowedRoute("agents", "GET"), true);
  assert.equal(allowedRoute("submit", "POST"), true);
  assert.equal(allowedRoute("submit", "GET"), false);
  assert.equal(allowedRoute("job/abc-123/report", "GET"), true);
  assert.equal(allowedRoute("job/abc-123/cancel", "POST"), true);
  assert.equal(allowedRoute("admin/config", "GET"), false);
  assert.equal(allowedRoute("../chat", "GET"), false);
});

test("research submission validation rejects malformed requests", () => {
  const { validateSubmit } = researchProxyInternals;
  assert.equal(validateSubmit({ agent_type: "deep_researcher", input: "Research this topic" }), null);
  assert.match(validateSubmit({ agent_type: "unknown", input: "hello" }), /agent_type/);
  assert.match(validateSubmit({ agent_type: "deep_researcher", input: " " }), /input/);
  assert.match(validateSubmit({ agent_type: "deep_researcher", input: "ok", data_sources: "web" }), /data_sources/);
});

test("research proxy fails closed when backend secrets are missing", async () => {
  const request = new Request("https://nexora.example/api/research/agents");
  const response = await onRequest({ request, env: {} });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "research_backend_not_configured");
});

test("research proxy keeps the backend token server-side and streams upstream bodies", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response("event: stream.mode\ndata: {\"mode\":\"live\"}\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    });
  };
  try {
    const request = new Request("https://nexora.example/api/research/job/job-123/stream");
    const response = await onRequest({
      request,
      env: {
        DEEP_RESEARCHER_URL: "https://research.example/",
        NEXORA_RESEARCH_API_TOKEN: "server-only-test-token"
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "text/event-stream");
    assert.equal(captured.url, "https://research.example/v1/jobs/async/job/job-123/stream");
    assert.equal(captured.init.headers.Authorization, "Bearer server-only-test-token");
    assert.equal(await response.text(), "event: stream.mode\ndata: {\"mode\":\"live\"}\n\n");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("research proxy refuses insecure remote backend URLs", async () => {
  const request = new Request("https://nexora.example/api/research/agents");
  const response = await onRequest({
    request,
    env: {
      DEEP_RESEARCHER_URL: "http://research.example",
      NEXORA_RESEARCH_API_TOKEN: "x".repeat(48)
    }
  });
  assert.equal(response.status, 503);
});
