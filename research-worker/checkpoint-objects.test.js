import test from "node:test";
import assert from "node:assert/strict";
import { handleCheckpointObjectRequest } from "./checkpoint-objects.js";

function fakeBucket() {
  const values = new Map();
  return {
    values,
    async put(key, value, options) {
      values.set(key, {
        bytes: new Uint8Array(value),
        customMetadata: options.customMetadata,
        httpMetadata: options.httpMetadata,
        async arrayBuffer() { return this.bytes.slice().buffer; },
      });
    },
    async get(key) { return values.get(key) || null; },
    async delete(key) { values.delete(key); },
  };
}

function fakeDb() {
  return {
    prepare() {
      return {
        bind() { return this; },
        async run() { return { success: true, meta: { changes: 1 } }; },
      };
    },
    async batch() { return []; },
  };
}

function request(path, method = "GET", body = undefined) {
  return new Request("https://research.internal" + path, {
    method,
    body,
    headers: body === undefined ? {} : { "content-type": "application/octet-stream" },
  });
}

test("R2 checkpoint payload upload returns a server-generated object ID and SHA-256", async () => {
  const bucket = fakeBucket();
  const bytes = new TextEncoder().encode("typed checkpoint bytes");
  const response = await handleCheckpointObjectRequest(
    request("/internal/checkpoint-objects/tenant-a/objects", "POST", bytes),
    { RESEARCH_CHECKPOINTS_BUCKET: bucket, RESEARCH_CHECKPOINTS_DB: fakeDb() },
    "tenant-a",
  );
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.size, bytes.byteLength);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(bucket.values.size, 1);
  assert.ok([...bucket.values.keys()][0].startsWith("nexora-checkpoints/tenant-a/"));
});

test("R2 checkpoint payload download verifies bytes and preserves binary content", async () => {
  const bucket = fakeBucket();
  const bytes = new Uint8Array([0, 255, 1, 128, 42]);
  const put = await handleCheckpointObjectRequest(
    request("/internal/checkpoint-objects/tenant-a/objects", "POST", bytes),
    { RESEARCH_CHECKPOINTS_BUCKET: bucket, RESEARCH_CHECKPOINTS_DB: fakeDb() },
    "tenant-a",
  );
  const { objectId } = await put.json();
  const get = await handleCheckpointObjectRequest(
    request("/internal/checkpoint-objects/tenant-a/objects/" + objectId),
    { RESEARCH_CHECKPOINTS_BUCKET: bucket, RESEARCH_CHECKPOINTS_DB: fakeDb() },
    "tenant-a",
  );
  assert.equal(get.status, 200);
  assert.deepEqual([...new Uint8Array(await get.arrayBuffer())], [...bytes]);
});

test("R2 checkpoint payload integrity mismatches fail closed", async () => {
  const bucket = fakeBucket();
  const put = await handleCheckpointObjectRequest(
    request("/internal/checkpoint-objects/tenant-a/objects", "POST", new Uint8Array([1, 2, 3])),
    { RESEARCH_CHECKPOINTS_BUCKET: bucket, RESEARCH_CHECKPOINTS_DB: fakeDb() },
    "tenant-a",
  );
  const { objectId } = await put.json();
  const key = [...bucket.values.keys()][0];
  bucket.values.get(key).bytes[0] = 9;
  const get = await handleCheckpointObjectRequest(
    request("/internal/checkpoint-objects/tenant-a/objects/" + objectId),
    { RESEARCH_CHECKPOINTS_BUCKET: bucket, RESEARCH_CHECKPOINTS_DB: fakeDb() },
    "tenant-a",
  );
  assert.equal(get.status, 500);
});

test("R2 checkpoint objects are tenant scoped and cannot be addressed with traversal", async () => {
  const bucket = fakeBucket();
  const put = await handleCheckpointObjectRequest(
    request("/internal/checkpoint-objects/tenant-a/objects", "POST", new Uint8Array([4])),
    { RESEARCH_CHECKPOINTS_BUCKET: bucket, RESEARCH_CHECKPOINTS_DB: fakeDb() },
    "tenant-a",
  );
  const { objectId } = await put.json();
  const otherTenant = await handleCheckpointObjectRequest(
    request("/internal/checkpoint-objects/tenant-b/objects/" + objectId),
    { RESEARCH_CHECKPOINTS_BUCKET: bucket, RESEARCH_CHECKPOINTS_DB: fakeDb() },
    "tenant-b",
  );
  assert.equal(otherTenant.status, 404);
  const traversal = await handleCheckpointObjectRequest(
    request("/internal/checkpoint-objects/tenant-a/objects/../secret"),
    { RESEARCH_CHECKPOINTS_BUCKET: bucket, RESEARCH_CHECKPOINTS_DB: fakeDb() },
    "tenant-a",
  );
  assert.equal(traversal.status, 404);
});

test("R2 checkpoint object deletion is tenant scoped and idempotent", async () => {
  const bucket = fakeBucket();
  const put = await handleCheckpointObjectRequest(
    request("/internal/checkpoint-objects/tenant-a/objects", "POST", new Uint8Array([5])),
    { RESEARCH_CHECKPOINTS_BUCKET: bucket, RESEARCH_CHECKPOINTS_DB: fakeDb() },
    "tenant-a",
  );
  const { objectId } = await put.json();
  const deleted = await handleCheckpointObjectRequest(
    request("/internal/checkpoint-objects/tenant-a/objects/" + objectId, "DELETE"),
    { RESEARCH_CHECKPOINTS_BUCKET: bucket, RESEARCH_CHECKPOINTS_DB: fakeDb() },
    "tenant-a",
  );
  assert.equal((await deleted.json()).deleted, true);
  const missing = await handleCheckpointObjectRequest(
    request("/internal/checkpoint-objects/tenant-a/objects/" + objectId, "DELETE"),
    { RESEARCH_CHECKPOINTS_BUCKET: bucket, RESEARCH_CHECKPOINTS_DB: fakeDb() },
    "tenant-a",
  );
  assert.equal((await missing.json()).deleted, false);
});

test("R2 checkpoint object routes fail clearly when the bucket is not bound", async () => {
  const response = await handleCheckpointObjectRequest(
    request("/internal/checkpoint-objects/tenant-a/objects", "POST", new Uint8Array([1])),
    {},
    "tenant-a",
  );
  assert.equal(response.status, 503);
});
