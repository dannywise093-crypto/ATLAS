import { DurableObject } from "cloudflare:workers";
import { constantTimeEqual, extractBearerToken, isSafeStorageSegment } from "./storage-policy.js";

const MAX_RECORD_BYTES = 256 * 1024;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_PAGE_SIZE = 200;

function response(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

async function readJson(request, maxBytes) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Response("Payload too large.", { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new Response("Payload too large.", { status: 413 });
  }
  try { return JSON.parse(raw); }
  catch { throw new Response("Invalid JSON.", { status: 400 }); }
}

export class ResearchStorage extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS records (
      tenant TEXT NOT NULL, namespace TEXT NOT NULL, record_key TEXT NOT NULL,
      value_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (tenant, namespace, record_key)
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      tenant TEXT NOT NULL, job_id TEXT NOT NULL, seq INTEGER NOT NULL,
      event_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (tenant, job_id, seq)
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS events_created_idx ON events(tenant, job_id, created_at)");
  }

  async fetch(request) {
    const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\\s+/i, "");
    const expected = this.env.NEXORA_RESEARCH_API_TOKEN;
    if (!expected || expected.length < 32 || !constantTimeEqual(supplied, expected)) {
      return response({ error: "Unauthorized." }, 401);
    }

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "v1" || parts[1] !== "tenants" || !isSafeStorageSegment(parts[2])) {
      return response({ error: "Not found." }, 404);
    }
    const tenant = parts[2];

    try {
      if (parts[3] === "records" && parts.length === 6) {
        const [, , , , namespace, key] = parts;
        if (!isSafeStorageSegment(namespace) || !isSafeStorageSegment(key)) {
          return response({ error: "Invalid storage key." }, 400);
        }
        return await this.record(request, tenant, namespace, key);
      }
      if (parts[3] === "events" && parts.length === 5) {
        const jobId = parts[4];
        if (!isSafeStorageSegment(jobId)) return response({ error: "Invalid job ID." }, 400);
        return await this.eventLog(request, tenant, jobId);
      }
      return response({ error: "Not found." }, 404);
    } catch (error) {
      if (error instanceof Response) return error;
      return response({ error: "Storage operation failed." }, 500);
    }
  }

  async record(request, tenant, namespace, key) {
    if (request.method === "GET") {
      const row = this.sql.exec(
        "SELECT value_json, revision, updated_at FROM records WHERE tenant=? AND namespace=? AND record_key=?",
        tenant, namespace, key
      ).toArray()[0];
      if (!row) return response({ error: "Record not found." }, 404);
      return response({ value: JSON.parse(row.value_json), revision: row.revision, updatedAt: row.updated_at });
    }

    if (request.method === "PUT") {
      const body = await readJson(request, MAX_RECORD_BYTES);
      if (!Object.hasOwn(body, "value")) return response({ error: "Missing value." }, 400);
      const current = this.sql.exec(
        "SELECT revision FROM records WHERE tenant=? AND namespace=? AND record_key=?",
        tenant, namespace, key
      ).toArray()[0];
      const expected = body.expectedRevision;
      if (expected !== undefined && expected !== null && expected !== (current?.revision ?? 0)) {
        return response({ error: "Revision conflict.", revision: current?.revision ?? 0 }, 409);
      }
      const now = Date.now();
      const revision = (current?.revision ?? 0) + 1;
      this.sql.exec(
        `INSERT INTO records(tenant,namespace,record_key,value_json,revision,updated_at)
         VALUES(?,?,?,?,?,?) ON CONFLICT(tenant,namespace,record_key)
         DO UPDATE SET value_json=excluded.value_json, revision=excluded.revision, updated_at=excluded.updated_at`,
        tenant, namespace, key, JSON.stringify(body.value), revision, now
      );
      return response({ ok: true, revision, updatedAt: now });
    }

    if (request.method === "DELETE") {
      const result = this.sql.exec(
        "DELETE FROM records WHERE tenant=? AND namespace=? AND record_key=?",
        tenant, namespace, key
      );
      return response({ ok: true, deleted: result.rowsWritten > 0 });
    }
    return response({ error: "Method not allowed." }, 405);
  }

  async eventLog(request, tenant, jobId) {
    if (request.method === "POST") {
      const body = await readJson(request, MAX_EVENT_BYTES);
      if (!Object.hasOwn(body, "event")) return response({ error: "Missing event." }, 400);
      const last = this.sql.exec(
        "SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE tenant=? AND job_id=?",
        tenant, jobId
      ).toArray()[0].seq;
      const seq = last + 1;
      this.sql.exec(
        "INSERT INTO events(tenant,job_id,seq,event_json,created_at) VALUES(?,?,?,?,?)",
        tenant, jobId, seq, JSON.stringify(body.event), Date.now()
      );
      return response({ ok: true, sequence: seq }, 201);
    }

    if (request.method === "GET") {
      const after = Math.max(0, Number(urlParam(request, "after", "0")) || 0);
      const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(urlParam(request, "limit", "100")) || 100));
      const rows = this.sql.exec(
        "SELECT seq,event_json,created_at FROM events WHERE tenant=? AND job_id=? AND seq>? ORDER BY seq LIMIT ?",
        tenant, jobId, after, limit
      ).toArray();
      return response({
        events: rows.map((row) => ({ sequence: row.seq, event: JSON.parse(row.event_json), createdAt: row.created_at })),
        nextAfter: rows.length ? rows[rows.length - 1].seq : after,
      });
    }
    return response({ error: "Method not allowed." }, 405);
  }
}

function urlParam(request, key, fallback) {
  return new URL(request.url).searchParams.get(key) ?? fallback;
}
