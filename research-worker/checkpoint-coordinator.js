import { DurableObject } from "cloudflare:workers";
import { D1CheckpointIndex } from "./checkpoint-index.js";
import { CheckpointCoordinatorCore, CheckpointLeaseError } from "./checkpoint-coordinator-core.js";
import { constantTimeEqual, extractBearerToken } from "./policy.js";

const MAX_BODY_BYTES = 128 * 1024;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

export class CheckpointCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS checkpoint_coordinator_state (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.core = null;
  }

  getCore() {
    if (this.core) return this.core;
    if (!this.env.RESEARCH_CHECKPOINTS_DB) {
      throw new CheckpointLeaseError("Checkpoint D1 database is not configured.", "missing_binding", 503);
    }
    const loadState = async () => {
      const row = this.sql.exec(
        "SELECT state_json FROM checkpoint_coordinator_state WHERE singleton_id = 1"
      ).toArray()[0];
      return row ? JSON.parse(row.state_json) : { scope: null, lastFencingToken: 0, lease: null };
    };
    const saveState = async (state) => {
      const encoded = JSON.stringify(state);
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(
          `INSERT INTO checkpoint_coordinator_state(singleton_id,state_json,updated_at)
           VALUES(1,?,?) ON CONFLICT(singleton_id)
           DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`,
          encoded, Date.now()
        );
      });
    };
    this.core = new CheckpointCoordinatorCore({
      loadState,
      saveState,
      checkpointIndex: new D1CheckpointIndex(this.env.RESEARCH_CHECKPOINTS_DB),
    });
    return this.core;
  }

  async fetch(request) {
    const supplied = extractBearerToken(request.headers.get("authorization"));
    const expected = this.env.NEXORA_RESEARCH_API_TOKEN;
    if (!expected || expected.length < 32 || !constantTimeEqual(supplied, expected)) {
      return json({ error: "Unauthorized." }, 401);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const route = new URL(request.url).pathname;
    if (!["/acquire", "/renew", "/release", "/publish", "/get", "/list", "/put-writes", "/list-writes"].includes(route)) {
      return json({ error: "Coordinator route not found." }, 404);
    }
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_BODY_BYTES) return json({ error: "Request body is too large." }, 413);
    let input;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        return json({ error: "Request body is too large." }, 413);
      }
      input = JSON.parse(raw);
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid object");
    } catch {
      return json({ error: "A valid JSON object is required." }, 400);
    }
    try {
      const coordinatorUrl = new URL(request.url);
      const tenantId = coordinatorUrl.searchParams.get("tenant");
      const threadId = coordinatorUrl.searchParams.get("thread");
      const checkpointNs = coordinatorUrl.searchParams.get("namespace") ?? "";
      if (!tenantId || !threadId || checkpointNs.length > 256) {
        return json({ error: "Coordinator identity is missing or invalid." }, 400);
      }
      input.tenantId = tenantId;
      input.threadId = threadId;
      input.checkpointNs = checkpointNs;
      const core = this.getCore();
      if (route === "/acquire") return json(await core.acquire(input), 201);
      if (route === "/renew") return json(await core.renew(input));
      if (route === "/release") return json(await core.release(input));
      if (route === "/publish") return json(await core.publish(input));
      const index = new D1CheckpointIndex(this.env.RESEARCH_CHECKPOINTS_DB);
      if (route === "/get") {
        if (typeof input.checkpointId !== "string") return json({ error: "checkpointId is required." }, 400);
        const checkpoint = await index.getCheckpoint(input);
        return checkpoint ? json({ checkpoint }) : json({ error: "Checkpoint not found." }, 404);
      }
      if (route === "/list") {
        return json({ checkpoints: await index.listCheckpoints(input) });
      }
      if (route === "/put-writes") {
        return json(await index.putWrites(input), 201);
      }
      if (route === "/list-writes") {
        if (typeof input.checkpointId !== "string") return json({ error: "checkpointId is required." }, 400);
        return json({ writes: await index.listWrites(input) });
      }
    } catch (error) {
      if (error instanceof CheckpointLeaseError) {
        return json({ error: error.message, code: error.code }, error.status);
      }
      if (error?.code === "write_conflict" || error?.code === "fencing_conflict") {
        return json({ error: "Checkpoint publication lost its revision or fencing race.", code: error.code }, 409);
      }
      return json({ error: "Checkpoint coordinator operation failed." }, 500);
    }
  }
}
