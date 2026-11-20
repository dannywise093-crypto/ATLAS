import test from "node:test";
import assert from "node:assert/strict";
import { onRequest, researchProxyInternals } from "./research/[[path]].js";

const SERVICE_TOKEN = "server-only-test-token-0123456789-abcdefghij";

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

test("research proxy fails closed when the service binding or token is missing", async () => {
  const request = new Request("https://nexora.example/api/research/agents");
  const response = await onRequest({ request, env: {} });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "research_backend_not_configured");
});

test("research proxy forwards the private token and streams service-binding responses", async () => {
  let captured;
  const request = new Request("https://nexora.example/api/research/job/job-123/stream");
  const response = await onRequest({
    request,
    env: {
      NEXORA_RESEARCH_API_TOKEN: SERVICE_TOKEN,
      NEXORA_RESEARCH: {
        fetch: async (upstreamRequest) => {
          captured = {
            url: upstreamRequest.url,
            method: upstreamRequest.method,
            authorization: upstreamRequest.headers.get("authorization"),
            accept: upstreamRequest.headers.get("accept")
          };
          return new Response("event: stream.mode\ndata: {\"mode\":\"live\"}\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream" }
          });
        }
      }
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/event-stream");
  assert.equal(captured.url, "https://nexora-deep-researcher.internal/v1/jobs/async/job/job-123/stream");
  assert.equal(captured.method, "GET");
  assert.equal(captured.authorization, "Bearer " + SERVICE_TOKEN);
  assert.equal(captured.accept, "text/event-stream");
  assert.equal(await response.text(), "event: stream.mode\ndata: {\"mode\":\"live\"}\n\n");
});

test("research proxy forwards JSON submissions through the private service binding", async () => {
  let captured;
  const request = new Request("https://nexora.example/api/research/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_type: "deep_researcher", input: "Compare current battery technologies" })
  });
  const response = await onRequest({
    request,
    env: {
      NEXORA_RESEARCH_API_TOKEN: SERVICE_TOKEN,
      NEXORA_RESEARCH: {
        fetch: async (upstreamRequest) => {
          captured = {
            url: upstreamRequest.url,
            method: upstreamRequest.method,
            authorization: upstreamRequest.headers.get("authorization"),
            body: await upstreamRequest.json()
          };
          return Response.json({ job_id: "job-456" }, { status: 202 });
        }
      }
    }
  });

  assert.equal(response.status, 202);
  assert.equal(captured.url, "https://nexora-deep-researcher.internal/v1/jobs/async/submit");
  assert.equal(captured.method, "POST");
  assert.equal(captured.authorization, "Bearer " + SERVICE_TOKEN);
  assert.equal(captured.body.input, "Compare current battery technologies");
});
