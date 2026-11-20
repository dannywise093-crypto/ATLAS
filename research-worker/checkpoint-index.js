const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_JSON_BYTES = 256 * 1024;

export class CheckpointIndexError extends Error {
  constructor(message, code = "checkpoint_index_error") {
    super(message);
    this.name = "CheckpointIndexError";
    this.code = code;
  }
}

function requiredId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new CheckpointIndexError("Invalid " + label + ".", "invalid_input");
  }
  return value;
}

function descriptor(value, label, tenantId) {
  if (!value || typeof value !== "object") throw new CheckpointIndexError("Missing " + label + ".", "invalid_input");
  const type = requiredId(value.type, label + " type");
  const key = typeof value.key === "string" && value.key.startsWith("nexora-checkpoints/" + tenantId + "/") ? value.key : "";
  if (!key || !SHA256.test(value.sha256 || "") || !Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    throw new CheckpointIndexError("Invalid " + label + " descriptor.", "invalid_input");
  }
  return { type, key, sha256: value.sha256, bytes: value.bytes };
}

function jsonProjection(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new CheckpointIndexError(label + " exceeds the D1 projection limit.", "invalid_input");
  }
  try { JSON.parse(text); } catch { throw new CheckpointIndexError(label + " must be valid JSON.", "invalid_input"); }
  return text;
}

function scope(input) {
  const checkpointNs = input.checkpointNs ?? "";
  if (typeof checkpointNs !== "string" || checkpointNs.length > 256 || /[\\u0000-\\u001f]/.test(checkpointNs)) {
    throw new CheckpointIndexError("Invalid checkpoint namespace.", "invalid_input");
  }
  return {
    tenantId: requiredId(input.tenantId, "tenant"),
    threadId: requiredId(input.threadId, "thread"),
    checkpointNs,
  };
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

export class D1CheckpointIndex {
  constructor(db) {
    if (!db || typeof db.prepare !== "function" || typeof db.batch !== "function") {
      throw new CheckpointIndexError("A Cloudflare D1 database binding is required.", "missing_binding");
    }
    this.db = db;
  }

  async claimThread(input) {
    const s = scope(input);
    const fencingToken = input.fencingToken;
    const now = Number.isSafeInteger(input.now) ? input.now : Date.now();
    if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) {
      throw new CheckpointIndexError("A positive fencing token is required.", "invalid_input");
    }
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO research_checkpoint_threads
        (tenant_id, thread_id, checkpoint_ns, head_checkpoint_id, revision, fencing_token, created_at, updated_at)
      VALUES (?, ?, ?, NULL, 0, ?, ?, ?)
    `).bind(s.tenantId, s.threadId, s.checkpointNs, fencingToken, now, now);
    const advance = this.db.prepare(`
      UPDATE research_checkpoint_threads
      SET fencing_token = ?, updated_at = ?
      WHERE tenant_id = ? AND thread_id = ? AND checkpoint_ns = ?
        AND fencing_token < ? AND deleted_at IS NULL
    `).bind(fencingToken, now, s.tenantId, s.threadId, s.checkpointNs, fencingToken);
    const results = await this.db.batch([insert, advance]);
    const row = await this.getThread(s);
    if (!row || row.fencing_token !== fencingToken) {
      throw new CheckpointIndexError("A newer fencing token already owns this checkpoint thread.", "fencing_conflict");
    }
    return { ...row, claimed: true };
  }

  async putCheckpoint(input) {
    const s = scope(input);
    const checkpointId = requiredId(input.checkpointId, "checkpoint ID");
    const parentId = input.parentCheckpointId == null ? null : requiredId(input.parentCheckpointId, "parent checkpoint ID");
    const checkpoint = descriptor(input.checkpoint, "checkpoint", s.tenantId);
    const metadata = descriptor(input.metadata, "metadata", s.tenantId);
    const expectedRevision = input.expectedRevision;
    const fencingToken = input.fencingToken;
    const createdAt = Number.isSafeInteger(input.createdAt) ? input.createdAt : Date.now();
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        !Number.isSafeInteger(fencingToken) || fencingToken < 1) {
      throw new CheckpointIndexError("A non-negative expected revision and positive fencing token are required.", "invalid_input");
    }
    const metadataJson = jsonProjection(input.metadataJson, "Metadata projection");
    const channelVersionsJson = jsonProjection(input.channelVersionsJson, "Channel versions projection");
    const threadInsert = this.db.prepare(`
      INSERT OR IGNORE INTO research_checkpoint_threads
        (tenant_id, thread_id, checkpoint_ns, head_checkpoint_id, revision, fencing_token, created_at, updated_at)
      VALUES (?, ?, ?, NULL, 0, ?, ?, ?)
    `).bind(s.tenantId, s.threadId, s.checkpointNs, fencingToken, createdAt, createdAt);
    const advance = this.db.prepare(`
      UPDATE research_checkpoint_threads
      SET head_checkpoint_id = ?, revision = revision + 1, updated_at = ?
      WHERE tenant_id = ? AND thread_id = ? AND checkpoint_ns = ?
        AND revision = ? AND fencing_token = ? AND deleted_at IS NULL
        AND head_checkpoint_id IS ?
        AND NOT EXISTS (
          SELECT 1 FROM research_checkpoints
          WHERE tenant_id = ? AND thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
        )
    `).bind(
      checkpointId, createdAt, s.tenantId, s.threadId, s.checkpointNs,
      expectedRevision, fencingToken, parentId,
      s.tenantId, s.threadId, s.checkpointNs, checkpointId,
    );
    const insert = this.db.prepare(`
      INSERT INTO research_checkpoints (
        tenant_id, thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
        checkpoint_type, checkpoint_r2_key, checkpoint_sha256, checkpoint_bytes,
        metadata_type, metadata_r2_key, metadata_sha256, metadata_bytes,
        metadata_json, channel_versions_json, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM research_checkpoint_threads
        WHERE tenant_id = ? AND thread_id = ? AND checkpoint_ns = ?
          AND revision = ? AND head_checkpoint_id = ? AND fencing_token = ? AND deleted_at IS NULL
      )
    `).bind(
      s.tenantId, s.threadId, s.checkpointNs, checkpointId, parentId,
      checkpoint.type, checkpoint.key, checkpoint.sha256, checkpoint.bytes,
      metadata.type, metadata.key, metadata.sha256, metadata.bytes,
      metadataJson, channelVersionsJson, createdAt,
      s.tenantId, s.threadId, s.checkpointNs, expectedRevision + 1, checkpointId, fencingToken,
    );
    const results = await this.db.batch([threadInsert, advance, insert]);
    if (changes(results[1]) !== 1 || changes(results[2]) !== 1) {
      throw new CheckpointIndexError("Checkpoint revision or fencing token is stale; no checkpoint was published.", "write_conflict");
    }
    return { checkpointId, revision: expectedRevision + 1, createdAt };
  }

  async getCheckpoint(input) {
    const s = scope(input);
    const checkpointId = requiredId(input.checkpointId, "checkpoint ID");
    const row = await this.db.prepare(`
      SELECT * FROM research_checkpoints
      WHERE tenant_id = ? AND thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
    `).bind(s.tenantId, s.threadId, s.checkpointNs, checkpointId).first();
    return row || null;
  }

  async getThread(input) {
    const s = scope(input);
    const row = await this.db.prepare(`
      SELECT tenant_id, thread_id, checkpoint_ns, head_checkpoint_id, revision, fencing_token, created_at, updated_at
      FROM research_checkpoint_threads
      WHERE tenant_id = ? AND thread_id = ? AND checkpoint_ns = ? AND deleted_at IS NULL
    `).bind(s.tenantId, s.threadId, s.checkpointNs).first();
    return row || null;
  }

  async listCheckpoints(input) {
    const s = scope(input);
    const limit = Math.min(100, Math.max(1, Number.isSafeInteger(input.limit) ? input.limit : 20));
    const before = input.beforeCheckpointId == null ? null : requiredId(input.beforeCheckpointId, "before checkpoint ID");
    const query = before === null
      ? this.db.prepare(`
          SELECT * FROM research_checkpoints
          WHERE tenant_id = ? AND thread_id = ? AND checkpoint_ns = ?
          ORDER BY checkpoint_id DESC LIMIT ?
        `).bind(s.tenantId, s.threadId, s.checkpointNs, limit)
      : this.db.prepare(`
          SELECT * FROM research_checkpoints
          WHERE tenant_id = ? AND thread_id = ? AND checkpoint_ns = ? AND checkpoint_id < ?
          ORDER BY checkpoint_id DESC LIMIT ?
        `).bind(s.tenantId, s.threadId, s.checkpointNs, before, limit);
    const result = await query.all();
    return result.results || [];
  }

  async putWrites(input) {
    const s = scope(input);
    const checkpointId = requiredId(input.checkpointId, "checkpoint ID");
    if (!Array.isArray(input.writes) || input.writes.length < 1 || input.writes.length > 128) {
      throw new CheckpointIndexError("Writes must contain between 1 and 128 entries.", "invalid_input");
    }
    const statements = input.writes.map((write) => {
      const payload = descriptor(write.value, "write value", s.tenantId);
      const taskId = requiredId(write.taskId, "task ID");
      const channel = requiredId(write.channel, "write channel");
      const taskPath = typeof write.taskPath === "string" ? write.taskPath.slice(0, 1024) : "";
      if (!Number.isSafeInteger(write.writeIndex) || write.writeIndex < 0) {
        throw new CheckpointIndexError("Invalid write index.", "invalid_input");
      }
      return this.db.prepare(`
        INSERT OR IGNORE INTO research_checkpoint_writes (
          tenant_id, thread_id, checkpoint_ns, checkpoint_id, task_id, task_path,
          write_index, channel, value_type, value_r2_key, value_sha256, value_bytes, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM research_checkpoints
          WHERE tenant_id = ? AND thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
        )
      `).bind(
        s.tenantId, s.threadId, s.checkpointNs, checkpointId, taskId, taskPath,
        write.writeIndex, channel, payload.type, payload.key, payload.sha256, payload.bytes,
        Number.isSafeInteger(write.createdAt) ? write.createdAt : Date.now(),
        s.tenantId, s.threadId, s.checkpointNs, checkpointId,
      );
    });
    const results = await this.db.batch(statements);
    if (results.some((result) => !result.success)) {
      throw new CheckpointIndexError("Could not persist checkpoint writes.", "storage_error");
    }
    return { accepted: results.reduce((sum, result) => sum + changes(result), 0), requested: statements.length };
  }

  async listWrites(input) {
    const s = scope(input);
    const checkpointId = requiredId(input.checkpointId, "checkpoint ID");
    const result = await this.db.prepare(`
      SELECT * FROM research_checkpoint_writes
      WHERE tenant_id = ? AND thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
      ORDER BY task_path, task_id, write_index
    `).bind(s.tenantId, s.threadId, s.checkpointNs, checkpointId).all();
    return result.results || [];
  }

  async enqueueGarbage(input) {
    const tenantId = requiredId(input.tenantId, "tenant");
    const objectKey = input.objectKey;
    if (typeof objectKey !== "string" || !objectKey.startsWith("nexora-checkpoints/" + tenantId + "/")) {
      throw new CheckpointIndexError("Garbage object key is outside the tenant prefix.", "invalid_input");
    }
    const now = Number.isSafeInteger(input.queuedAt) ? input.queuedAt : Date.now();
    const notBefore = Number.isSafeInteger(input.notBefore) ? input.notBefore : now + 24 * 60 * 60 * 1000;
    await this.db.prepare(`
      INSERT OR IGNORE INTO research_checkpoint_r2_gc (object_key, tenant_id, queued_at, not_before)
      VALUES (?, ?, ?, ?)
    `).bind(objectKey, tenantId, now, notBefore).run();
    return { objectKey, notBefore };
  }

  async listDueGarbage(input = {}) {
    const now = Number.isSafeInteger(input.now) ? input.now : Date.now();
    const limit = Math.min(500, Math.max(1, Number.isSafeInteger(input.limit) ? input.limit : 100));
    const result = await this.db.prepare(`
      SELECT object_key, tenant_id, queued_at, not_before, attempts
      FROM research_checkpoint_r2_gc WHERE not_before <= ?
      ORDER BY not_before, queued_at LIMIT ?
    `).bind(now, limit).all();
    return result.results || [];
  }

  async removeGarbage(input) {
    const tenantId = requiredId(input.tenantId, "tenant");
    const objectKey = input.objectKey;
    if (typeof objectKey !== "string" || !objectKey.startsWith("nexora-checkpoints/" + tenantId + "/")) {
      throw new CheckpointIndexError("Garbage object key is outside the tenant prefix.", "invalid_input");
    }
    const result = await this.db.prepare(`
      DELETE FROM research_checkpoint_r2_gc WHERE object_key = ? AND tenant_id = ?
    `).bind(objectKey, tenantId).run();
    return changes(result) === 1;
  }
}
