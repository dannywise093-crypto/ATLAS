const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MIN_TTL_MS = 5_000;
const MAX_TTL_MS = 120_000;

export class CheckpointLeaseError extends Error {
  constructor(message, code = "lease_error", status = 409) {
    super(message);
    this.name = "CheckpointLeaseError";
    this.code = code;
    this.status = status;
  }
}

function validateScope(input) {
  const checkpointNs = input.checkpointNs ?? "";
  if (typeof input.tenantId !== "string" || !SAFE_ID.test(input.tenantId) ||
      typeof input.threadId !== "string" || !SAFE_ID.test(input.threadId) ||
      typeof checkpointNs !== "string" || checkpointNs.length > 256 ||
      /[\u0000-\u001f]/.test(checkpointNs)) {
    throw new CheckpointLeaseError("Invalid checkpoint thread scope.", "invalid_scope", 400);
  }
  return { tenantId: input.tenantId, threadId: input.threadId, checkpointNs };
}

function validateHolder(holderId) {
  if (typeof holderId !== "string" || !SAFE_ID.test(holderId)) {
    throw new CheckpointLeaseError("Invalid lease holder ID.", "invalid_holder", 400);
  }
  return holderId;
}

function validateTtl(ttlMs) {
  const value = ttlMs === undefined ? 30_000 : ttlMs;
  if (!Number.isSafeInteger(value) || value < MIN_TTL_MS || value > MAX_TTL_MS) {
    throw new CheckpointLeaseError("Lease duration must be between 5 and 120 seconds.", "invalid_ttl", 400);
  }
  return value;
}

export class CheckpointCoordinatorCore {
  constructor({ loadState, saveState, checkpointIndex, now = () => Date.now(), makeLeaseId = () => crypto.randomUUID() }) {
    if (typeof loadState !== "function" || typeof saveState !== "function" ||
        !checkpointIndex || typeof checkpointIndex.claimThread !== "function" ||
        typeof checkpointIndex.putCheckpoint !== "function") {
      throw new TypeError("Checkpoint coordinator requires durable state and a D1 checkpoint index.");
    }
    this.loadState = loadState;
    this.saveState = saveState;
    this.checkpointIndex = checkpointIndex;
    this.now = now;
    this.makeLeaseId = makeLeaseId;
    this.tail = Promise.resolve();
  }

  async exclusive(operation) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); }
    finally { release(); }
  }

  async bindScope(state, requested) {
    const scope = validateScope(requested);
    if (state.scope && (
      state.scope.tenantId !== scope.tenantId ||
      state.scope.threadId !== scope.threadId ||
      state.scope.checkpointNs !== scope.checkpointNs
    )) {
      throw new CheckpointLeaseError("This coordinator is already bound to another checkpoint thread.", "scope_conflict", 409);
    }
    return scope;
  }

  async acquire(input) {
    return this.exclusive(async () => {
      const state = await this.loadState();
      const scope = await this.bindScope(state, input);
      const now = this.now();
      const holderId = validateHolder(input.holderId);
      const ttlMs = validateTtl(input.ttlMs);
      if (state.lease && state.lease.expiresAt > now && state.lease.holderId !== holderId) {
        throw new CheckpointLeaseError("Checkpoint thread is currently leased by another runner.", "lease_busy", 409);
      }
      if (state.lease && state.lease.expiresAt > now && state.lease.holderId === holderId) {
        state.lease.expiresAt = now + ttlMs;
        await this.saveState(state);
        return { ...state.lease, reused: true };
      }

      const fencingToken = state.lastFencingToken + 1;
      const lease = {
        leaseId: this.makeLeaseId(),
        holderId,
        fencingToken,
        acquiredAt: now,
        expiresAt: now + ttlMs,
      };
      const next = { scope, lastFencingToken: fencingToken, lease };
      await this.saveState(next);
      try {
        await this.checkpointIndex.claimThread({ ...scope, fencingToken, now });
      } catch (error) {
        await this.saveState({ scope, lastFencingToken: fencingToken, lease: null });
        throw error;
      }
      return { ...lease, reused: false };
    });
  }

  async renew(input) {
    return this.exclusive(async () => {
      const state = await this.loadState();
      await this.bindScope(state, input);
      const lease = this.requireLease(state, input);
      lease.expiresAt = this.now() + validateTtl(input.ttlMs);
      await this.saveState(state);
      return { ...lease };
    });
  }

  async release(input) {
    return this.exclusive(async () => {
      const state = await this.loadState();
      await this.bindScope(state, input);
      this.requireLease(state, input);
      state.lease = null;
      await this.saveState(state);
      return { released: true };
    });
  }

  async publish(input) {
    return this.exclusive(async () => {
      const state = await this.loadState();
      const scope = await this.bindScope(state, input);
      const lease = this.requireLease(state, input);
      if (!input.checkpoint || typeof input.checkpoint !== "object" || Array.isArray(input.checkpoint)) {
        throw new CheckpointLeaseError("Checkpoint publication payload is required.", "invalid_checkpoint", 400);
      }
      const result = await this.checkpointIndex.putCheckpoint({
        ...input.checkpoint,
        ...scope,
        fencingToken: lease.fencingToken,
      });
      return { ...result, fencingToken: lease.fencingToken };
    });
  }

  requireLease(state, input) {
    const lease = state.lease;
    if (!lease || lease.expiresAt <= this.now() ||
        lease.holderId !== input.holderId ||
        lease.leaseId !== input.leaseId ||
        lease.fencingToken !== input.fencingToken) {
      throw new CheckpointLeaseError("Checkpoint lease is missing, expired, or no longer owned by this runner.", "lease_lost", 409);
    }
    return lease;
  }
}

export const checkpointCoordinatorLimits = { MIN_TTL_MS, MAX_TTL_MS };
