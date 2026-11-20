import test from "node:test";
import assert from "node:assert/strict";
import { D1CheckpointIndex, CheckpointIndexError } from "./checkpoint-index.js";

class FakeD1 {
  constructor() { this.state = { threads: new Map(), checkpoints: new Map() }; }
  prepare(sql) {
    const db = this;
    return {
      sql, args: [],
      bind(...args) { this.args = args; return this; },
      async first() { return db.execute(this.sql, this.args, db.state).row ?? null; },
      async all() { return { results: db.execute(this.sql, this.args, db.state).rows ?? [] }; },
      async run() { return db.execute(this.sql, this.args, db.state); },
    };
  }
  async batch(statements) {
    const next = structuredClone(this.state);
    const results = statements.map((s) => this.execute(s.sql, s.args, next));
    this.state = next;
    return results;
  }
  execute(sql, a, state) {
    const q = sql.replace(/\s+/g, " ").trim();
    if (q.startsWith("INSERT INTO research_checkpoint_threads")) {
      const k = [a[0], a[1], a[2]].join("|");
      if (!state.threads.has(k)) state.threads.set(k, {
        tenant_id:a[0],thread_id:a[1],checkpoint_ns:a[2],head_checkpoint_id:null,
        revision:0,fencing_token:a[3],created_at:a[4],updated_at:a[5],deleted_at:null,
      });
      return { success:true, meta:{changes:0} };
    }
    if (q.startsWith("UPDATE research_checkpoint_threads")) {
      const k = [a[2],a[3],a[4]].join("|"), t = state.threads.get(k);
      const duplicate = state.checkpoints.has([a[10],a[11],a[12],a[13]].join("|"));
      if (!t || t.revision !== a[5] || t.fencing_token !== a[6] ||
          t.head_checkpoint_id !== a[7] || t.deleted_at !== null || duplicate) {
        return { success:true, meta:{changes:0} };
      }
      t.head_checkpoint_id=a[0]; t.updated_at=a[1]; t.revision++;
      return { success:true, meta:{changes:1} };
    }
    if (q.startsWith("INSERT INTO research_checkpoints")) {
      const threadKey=[a[16],a[17],a[18]].join("|"), t=state.threads.get(threadKey);
      const k=[a[0],a[1],a[2],a[3]].join("|");
      if (!t || t.revision !== a[19] || t.head_checkpoint_id !== a[20] || t.fencing_token !== a[21] || state.checkpoints.has(k)) {
        return { success:true, meta:{changes:0} };
      }
      state.checkpoints.set(k,{
        tenant_id:a[0],thread_id:a[1],checkpoint_ns:a[2],checkpoint_id:a[3],
        parent_checkpoint_id:a[4],checkpoint_type:a[5],checkpoint_r2_key:a[6],
        checkpoint_sha256:a[7],checkpoint_bytes:a[8],metadata_type:a[9],
        metadata_r2_key:a[10],metadata_sha256:a[11],metadata_bytes:a[12],
        metadata_json:a[13],channel_versions_json:a[14],created_at:a[15],
      });
      return { success:true, meta:{changes:1} };
    }
    if (q.startsWith("DELETE FROM research_checkpoint_r2_gc")) {
      return { success:true, meta:{changes:0} };
    }
    if (q.startsWith("SELECT * FROM research_checkpoints")) {
      return { row:state.checkpoints.get(a.join("|")) ?? null };
    }
    if (q.startsWith("SELECT tenant_id, thread_id, checkpoint_ns")) {
      return { row:state.threads.get(a.join("|")) ?? null };
    }
    throw new Error("Unexpected SQL in FakeD1: " + q);
  }
}

const digest = "a".repeat(64);
const descriptor = (suffix) => ({
  type:"msgpack", key:"nexora-checkpoints/acme/" + suffix,
  sha256:digest, bytes:17,
});
const input = (overrides = {}) => ({
  tenantId:"acme", threadId:"thread-1", checkpointNs:"",
  checkpointId:"cp-001", parentCheckpointId:null,
  checkpoint:descriptor("payload-1"), metadata:descriptor("metadata-1"),
  metadataJson:{source:"test"}, channelVersionsJson:{messages:"1"},
  expectedRevision:0, fencingToken:7, createdAt:1000, ...overrides,
});

test("D1 checkpoint publication atomically advances the scoped head and stores typed R2 descriptors", async () => {
  const db = new FakeD1(), index = new D1CheckpointIndex(db);
  const result = await index.putCheckpoint(input());
  assert.deepEqual(result, {checkpointId:"cp-001",revision:1,createdAt:1000});
  const row = await index.getCheckpoint(input());
  assert.equal(row.checkpoint_type, "msgpack");
  assert.equal(row.checkpoint_r2_key, "nexora-checkpoints/acme/payload-1");
  assert.equal(row.metadata_sha256, digest);
  const thread = await index.getThread(input());
  assert.equal(thread.head_checkpoint_id, "cp-001");
  assert.equal(thread.revision, 1);
});

test("stale revision, parent, or fencing token cannot publish a checkpoint", async () => {
  const db = new FakeD1(), index = new D1CheckpointIndex(db);
  await index.putCheckpoint(input());
  await assert.rejects(
    index.putCheckpoint(input({checkpointId:"cp-002",parentCheckpointId:"cp-001",expectedRevision:0})),
    (error) => error instanceof CheckpointIndexError && error.code === "write_conflict",
  );
  await assert.rejects(
    index.putCheckpoint(input({checkpointId:"cp-003",parentCheckpointId:"cp-001",expectedRevision:1,fencingToken:6})),
    (error) => error.code === "write_conflict",
  );
  const thread = await index.getThread(input());
  assert.equal(thread.revision, 1);
  assert.equal(thread.head_checkpoint_id, "cp-001");
});

test("checkpoint reads are isolated by tenant, thread, and namespace", async () => {
  const index = new D1CheckpointIndex(new FakeD1());
  await index.putCheckpoint(input());
  assert.equal(await index.getCheckpoint(input({tenantId:"other"})), null);
  assert.equal(await index.getCheckpoint(input({threadId:"other-thread"})), null);
  assert.equal(await index.getCheckpoint(input({checkpointNs:"other-ns"})), null);
});

test("invalid typed payload descriptors and untrusted R2 prefixes are rejected before D1 writes", async () => {
  const index = new D1CheckpointIndex(new FakeD1());
  await assert.rejects(index.putCheckpoint(input({checkpoint:{...descriptor("bad"),sha256:"nope"}})),
    (error) => error instanceof CheckpointIndexError && error.code === "invalid_input");
  await assert.rejects(index.putCheckpoint(input({metadata:descriptor("wrong").key})),
    (error) => error instanceof CheckpointIndexError && error.code === "invalid_input");
  await assert.rejects(index.putCheckpoint(input({checkpoint: {
    ...descriptor("foreign"), key:"nexora-checkpoints/other-tenant/foreign"
  }})), (error) => error instanceof CheckpointIndexError && error.code === "invalid_input");
});

test("constructor fails closed without a D1 binding", () => {
  assert.throws(() => new D1CheckpointIndex(null),
    (error) => error instanceof CheckpointIndexError && error.code === "missing_binding");
});
