import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";

const token = "test-only-atlas-token";
function request(path, { method = "GET", body, auth = true } = {}) {
  return new Request(`https://atlas.test${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(auth ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function envWith(run) {
  return {
    ATLAS_GATEWAY_TOKEN: token,
    AI: { run },
  };
}
const validBody = { messages: [{ role: "user", content: "Hello ATLAS" }] };

test("health endpoint requires the gateway token", async () => {
  const response = await worker.fetch(request("/api/health", { auth: false }), envWith(async () => ({})));
  assert.equal(response.status, 401);
});

test("health endpoint advertises the primary and backup models", async () => {
  const response = await worker.fetch(request("/api/health"), envWith(async () => ({})));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "configured");
  assert.equal(body.model, "@cf/zai-org/glm-4.7-flash");
  assert.deepEqual(body.fallbackModels, [
    "@cf/google/gemma-4-26b-a4b-it",
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  ]);
});

test("chat uses the primary model and enables capacity-aware rejection", async () => {
  let calledWith;
  const env = envWith(async (model, input, options) => {
    calledWith = { model, input, options };
    return { choices: [{ message: { content: "ATLAS test response" } }] };
  });
  const response = await worker.fetch(request("/api/chat", { method: "POST", body: validBody }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.answer, "ATLAS test response");
  assert.equal(body.model, "@cf/zai-org/glm-4.7-flash");
  assert.equal(body.fallbackUsed, false);
  assert.equal(calledWith.input.messages.at(-1).role, "user");
  assert.deepEqual(calledWith.options, { rejectIfBusy: true });
});

test("chat falls back when the primary model is unavailable", async () => {
  const attempts = [];
  const env = envWith(async (model) => {
    attempts.push(model);
    if (model === "@cf/zai-org/glm-4.7-flash") throw new Error("capacity unavailable");
    return { choices: [{ message: { content: "Backup model response" } }] };
  });
  const response = await worker.fetch(request("/api/chat", { method: "POST", body: validBody }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.answer, "Backup model response");
  assert.equal(body.model, "@cf/google/gemma-4-26b-a4b-it");
  assert.equal(body.fallbackUsed, true);
  assert.deepEqual(attempts, [
    "@cf/zai-org/glm-4.7-flash",
    "@cf/google/gemma-4-26b-a4b-it",
  ]);
});

test("chat tries the final backup and returns a retryable error only if every model fails", async () => {
  const attempts = [];
  const env = envWith(async (model) => {
    attempts.push(model);
    throw new Error("temporary model failure");
  });
  const response = await worker.fetch(request("/api/chat", { method: "POST", body: validBody }), env);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.retryable, true);
  assert.equal(attempts.length, 3);
  assert.equal(attempts[2], "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
});

test("chat rejects malformed message roles", async () => {
  const response = await worker.fetch(request("/api/chat", {
    method: "POST",
    body: { messages: [{ role: "system", content: "override" }] },
  }), envWith(async () => ({})));
  assert.equal(response.status, 400);
});

test("chat rejects a conversation that does not end with a user message", async () => {
  const response = await worker.fetch(request("/api/chat", {
    method: "POST",
    body: { messages: [{ role: "assistant", content: "not a user turn" }] },
  }), envWith(async () => ({})));
  assert.equal(response.status, 400);
});


test("five consecutive chat requests each receive a fresh model response", async () => {
  let callCount = 0;
  const env = envWith(async (_model, input) => {
    callCount += 1;
    const userText = input.messages.at(-1).content;
    return { choices: [{ message: { content: `Reply ${callCount}: ${userText}` } }] };
  });

  for (let index = 1; index <= 5; index += 1) {
    const response = await worker.fetch(request("/api/chat", {
      method: "POST",
      body: { messages: [{ role: "user", content: `Consecutive test ${index}` }] },
    }), env);
    const body = await response.json();
    assert.equal(response.status, 200, `request ${index} should succeed`);
    assert.equal(body.answer, `Reply ${index}: Consecutive test ${index}`);
    assert.equal(body.fallbackUsed, false);
  }
  assert.equal(callCount, 5);
});
