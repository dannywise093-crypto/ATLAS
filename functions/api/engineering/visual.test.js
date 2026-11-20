import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "./visual.js";

function request(prompt, ip = "192.0.2.10") {
  return new Request("https://nexora.example/api/engineering/visual", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ prompt })
  });
}

test("Pages Engineering visual endpoint returns FLUX image bytes", async () => {
  let call;
  const response = await onRequestPost({
    request: request("A conceptual turbine assembly", "192.0.2.20"),
    env: { AI: { async run(model, input) {
      call = { model, input };
      return new Uint8Array([137, 80, 78, 71]);
    } } }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(call.model, "@cf/black-forest-labs/flux-1-schnell");
  assert.equal(call.input.steps, 4);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [137, 80, 78, 71]);
});

test("Pages Engineering visual endpoint validates prompts and AI binding", async () => {
  const invalid = await onRequestPost({
    request: request(" ", "192.0.2.21"),
    env: { AI: { async run() { throw new Error("must not run"); } } }
  });
  assert.equal(invalid.status, 400);

  const unavailable = await onRequestPost({
    request: request("A concept drawing", "192.0.2.22"),
    env: {}
  });
  assert.equal(unavailable.status, 503);
});

test("Pages Engineering visual endpoint applies a per-IP request limit", async () => {
  const env = { AI: { async run() { return new Uint8Array([1, 2, 3]); } } };
  const ip = "192.0.2.23";
  for (let index = 0; index < 3; index += 1) {
    const response = await onRequestPost({ request: request("A concept drawing", ip), env });
    assert.equal(response.status, 200);
  }
  const limited = await onRequestPost({ request: request("A concept drawing", ip), env });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "60");
});
