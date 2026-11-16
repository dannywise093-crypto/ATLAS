import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";
import { handleBrowserRequest, validateBrowserUrl } from "./browser.js";

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
  assert.equal(body.model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.deepEqual(body.fallbackModels, [
    "@cf/google/gemma-4-26b-a4b-it",
    "@cf/zai-org/glm-4.7-flash",
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
  assert.equal(body.model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.equal(body.fallbackUsed, false);
  assert.equal(calledWith.input.messages.at(-1).role, "user");
  assert.deepEqual(calledWith.options, { rejectIfBusy: true });
  assert.equal(calledWith.input.max_tokens, 3000);
  assert.equal("reasoning_effort" in calledWith.input, false);
  assert.equal("chat_template_kwargs" in calledWith.input, false);
  assert.match(calledWith.input.messages[0].content, /Your name and product identity are ATLAS/);
  assert.match(calledWith.input.messages[0].content, /created and developed by Danny Wise/);
  assert.match(calledWith.input.messages[0].content, /not Meta AI, not Llama/);
  assert.match(calledWith.input.messages[0].content, /primary inference model is Meta's Llama 3.3 70B/);
  assert.match(calledWith.input.messages[0].content, /complete, runnable code/);
  assert.match(calledWith.input.messages[0].content, /reject booleans, floats, and strings/);
  assert.match(calledWith.input.messages[0].content, /keep code and data memory regions separate/);
  assert.match(calledWith.input.messages[0].content, /instruction widths/);
  assert.match(calledWith.input.messages[0].content, /direct memory loads read memory/);
});

test("chat falls back when the primary model is unavailable", async () => {
  const attempts = [];
  const env = envWith(async (model) => {
    attempts.push(model);
    if (model === "@cf/meta/llama-3.3-70b-instruct-fp8-fast") throw new Error("capacity unavailable");
    return { choices: [{ message: { content: "Backup model response" } }] };
  });
  const response = await worker.fetch(request("/api/chat", { method: "POST", body: validBody }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.answer, "Backup model response");
  assert.equal(body.model, "@cf/google/gemma-4-26b-a4b-it");
  assert.equal(body.fallbackUsed, true);
  assert.deepEqual(attempts, [
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
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
  assert.equal(attempts[2], "@cf/zai-org/glm-4.7-flash");
  assert.deepEqual(body.diagnostics.map((item) => item.status), [
    "inference_error",
    "inference_error",
    "inference_error",
  ]);
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


test("chat accepts the native Workers AI response field", async () => {
  const env = envWith(async () => ({ response: "Native Workers AI response" }));
  const response = await worker.fetch(request("/api/chat", { method: "POST", body: validBody }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.answer, "Native Workers AI response");
  assert.equal(body.fallbackUsed, false);
});


test("chat falls back instead of returning a truncated model response", async () => {
  const attempts = [];
  const env = envWith(async (model) => {
    attempts.push(model);
    if (model === "@cf/meta/llama-3.3-70b-instruct-fp8-fast") {
      return { choices: [{ message: { content: "partial code" }, finish_reason: "length" }] };
    }
    return { choices: [{ message: { content: "Complete backup answer" }, finish_reason: "stop" }] };
  });
  const response = await worker.fetch(request("/api/chat", { method: "POST", body: validBody }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.answer, "Complete backup answer");
  assert.equal(body.model, "@cf/google/gemma-4-26b-a4b-it");
  assert.equal(body.fallbackUsed, true);
  assert.equal(attempts.length, 2);
});


test("Browser Run rejects private and local network destinations", () => {
  for (const url of ["http://localhost", "http://127.0.0.1", "http://192.168.1.1", "http://169.254.169.254", "http://service.local"]) {
    assert.throws(() => validateBrowserUrl(url), /blocked/);
  }
});

test("Browser Run validates public URLs and strips fragments", () => {
  assert.equal(validateBrowserUrl("https://example.com/path#section").toString(), "https://example.com/path");
  assert.throws(() => validateBrowserUrl("file:///etc/passwd"), /HTTP and HTTPS/);
  assert.throws(() => validateBrowserUrl("https://user:pass@example.com"), /HTTP and HTTPS/);
});

test("Browser Run reads a rendered page through the browser binding", async () => {
  let call;
  const request = new Request("https://atlas.test/api/browser", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "read", url: "https://example.com" }),
  });
  const response = await handleBrowserRequest(request, {
    BROWSER: { quickAction: async (action, input) => {
      call = { action, input };
      return new Response("# Example page", { headers: { "content-type": "text/markdown" } });
    } },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(call.action, "markdown");
  assert.equal(call.input.url, "https://example.com/");
  assert.equal(body.result, "# Example page");
});

test("Browser Run follows a discovered link by navigating to its URL", async () => {
  let call;
  const request = new Request("https://atlas.test/api/browser", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "click", href: "https://example.org/next" }),
  });
  const response = await handleBrowserRequest(request, {
    BROWSER: { quickAction: async (action, input) => {
      call = { action, input };
      return new Response("Destination page");
    } },
  });
  assert.equal(response.status, 200);
  assert.equal(call.action, "markdown");
  assert.equal(call.input.url, "https://example.org/next");
});

test("Browser Run rejects unsupported actions and private destinations", async () => {
  const env = { BROWSER: { quickAction: async () => { throw new Error("must not run"); } } };
  const unsupported = await handleBrowserRequest(new Request("https://atlas.test/api/browser", {
    method: "POST", body: JSON.stringify({ action: "submit", url: "https://example.com" }),
  }), env);
  assert.equal(unsupported.status, 400);
  const privateTarget = await handleBrowserRequest(new Request("https://atlas.test/api/browser", {
    method: "POST", body: JSON.stringify({ action: "read", url: "http://10.0.0.5" }),
  }), env);
  assert.equal(privateTarget.status, 400);
});
