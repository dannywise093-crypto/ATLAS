import test from "node:test";
import assert from "node:assert/strict";
import { drainCheckpointGarbage } from "./checkpoint-garbage-collector.js";

class GarbageDb {
  constructor(rows, referenced = []) {
    this.rows = rows.map((row) => ({ ...row }));
    this.referenced = new Set(referenced);
  }

  prepare(sql) {
    const db = this;
    return {
      sql,
      args: [],
      bind(...args) { this.args = args; return this; },
      async all() {
        if (this.sql.includes("FROM research_checkpoint_r2_gc")) {
          return { results: db.rows.slice(0, this.args[1]) };
        }
        throw new Error("Unexpected all query");
      },
      async first() {
        if (this.sql.includes("FROM research_checkpoints")) {
          return db.referenced.has(this.args[1]) ? { referenced: 1 } : null;
        }
        throw new Error("Unexpected first query");
      },
      async run() {
        if (this.sql.includes("DELETE FROM research_checkpoint_r2_gc")) {
          const [key, tenant] = this.args;
          const before = db.rows.length;
          db.rows = db.rows.filter((row) => !(row.object_key === key && row.tenant_id === tenant));
          return { success: true, meta: { changes: before - db.rows.length } };
        }
        throw new Error("Unexpected run query");
      },
    };
  }
}

test("garbage collector deletes only unreferenced tenant-scoped R2 objects", async () => {
  const rows = [
    { object_key: "nexora-checkpoints/tenant-a/orphan", tenant_id: "tenant-a" },
    { object_key: "nexora-checkpoints/tenant-a/kept", tenant_id: "tenant-a" },
    { object_key: "nexora-checkpoints/tenant-b/orphan", tenant_id: "tenant-b" },
    { object_key: "nexora-checkpoints/tenant-a-evil/foreign", tenant_id: "tenant-a" },
  ];
  const db = new GarbageDb(rows, ["nexora-checkpoints/tenant-a/kept"]);
  const deleted = [];
  const result = await drainCheckpointGarbage({
    RESEARCH_CHECKPOINTS_DB: db,
    RESEARCH_CHECKPOINTS_BUCKET: { async delete(key) { deleted.push(key); } },
  });

  assert.deepEqual(deleted, [
    "nexora-checkpoints/tenant-a/orphan",
    "nexora-checkpoints/tenant-b/orphan",
  ]);
  assert.equal(result.processed, 3);
  assert.deepEqual(db.rows.map((row) => row.object_key), [
    "nexora-checkpoints/tenant-a-evil/foreign",
  ]);
});

test("garbage collector retains queue entries when R2 deletion fails", async () => {
  const key = "nexora-checkpoints/tenant-a/retry";
  const db = new GarbageDb([{ object_key: key, tenant_id: "tenant-a" }]);
  const result = await drainCheckpointGarbage({
    RESEARCH_CHECKPOINTS_DB: db,
    RESEARCH_CHECKPOINTS_BUCKET: {
      async delete() { throw new Error("temporary R2 failure"); },
    },
  });

  assert.equal(result.processed, 0);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].object_key, key);
});

test("garbage collector safely no-ops until both Cloudflare bindings exist", async () => {
  assert.deepEqual(await drainCheckpointGarbage({}), { processed: 0 });
});
