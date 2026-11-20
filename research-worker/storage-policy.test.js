import test from "node:test";
import assert from "node:assert/strict";
import { isSafeStorageSegment, validStorageRequest } from "./storage-policy.js";

test("storage identifiers reject traversal and unsafe characters", () => {
  for (const value of ["tenant-1", "job_123", "research.v1"]) assert.equal(isSafeStorageSegment(value), true);
  for (const value of ["", ".", "..", "../x", "a/b", "a b", "a?b"]) assert.equal(isSafeStorageSegment(value), false);
});

test("record routes allow only scoped CRUD methods", () => {
  assert.equal(validStorageRequest("GET", "/v1/tenants/app/records/jobs/job-1"), true);
  assert.equal(validStorageRequest("PUT", "/v1/tenants/app/records/checkpoints/thread_1"), true);
  assert.equal(validStorageRequest("POST", "/v1/tenants/app/records/jobs/job-1"), false);
  assert.equal(validStorageRequest("GET", "/v1/tenants/app/records/jobs/../secret"), false);
});

test("event routes allow append and paginated reads only", () => {
  assert.equal(validStorageRequest("POST", "/v1/tenants/app/events/job-1"), true);
  assert.equal(validStorageRequest("GET", "/v1/tenants/app/events/job-1"), true);
  assert.equal(validStorageRequest("DELETE", "/v1/tenants/app/events/job-1"), false);
});
