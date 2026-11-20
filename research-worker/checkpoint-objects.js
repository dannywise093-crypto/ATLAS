const MAX_OBJECT_BYTES = 32 * 1024 * 1024;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function safeSegment(value) {
  return typeof value === "string" && SAFE_SEGMENT.test(value) && value !== "." && value !== "..";
}

function objectKey(tenant, objectId) {
  return "nexora-checkpoints/" + tenant + "/" + objectId;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function readBoundedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_OBJECT_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function handleCheckpointObjectRequest(request, env, tenant) {
  if (!safeSegment(tenant)) return json({ error: "Invalid tenant." }, 400);
  const bucket = env.RESEARCH_CHECKPOINTS_BUCKET;
  if (!bucket) return json({ error: "Checkpoint object storage is not configured." }, 503);

  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  if (parts.length === 4 && parts[3] === "objects" && request.method === "POST") {
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_OBJECT_BYTES) return json({ error: "Checkpoint payload is too large." }, 413);
    const bytes = await readBoundedBody(request);
    if (bytes === null) return json({ error: "Checkpoint payload is too large." }, 413);
    const objectId = crypto.randomUUID();
    const digest = await sha256(bytes);
    const createdAt = Date.now();
    const key = objectKey(tenant, objectId);
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: {
        tenant,
        sha256: digest,
        size: String(bytes.byteLength),
        createdAt: String(createdAt),
      },
    });
    return json({ ok: true, objectId, sha256: digest, size: bytes.byteLength, createdAt }, 201);
  }

  if (parts.length === 5 && parts[3] === "objects" && safeSegment(parts[4])) {
    const objectId = parts[4];
    const key = objectKey(tenant, objectId);
    if (request.method === "GET") {
      const object = await bucket.get(key);
      if (!object) return json({ error: "Checkpoint payload not found." }, 404);
      if (object.customMetadata?.tenant !== tenant) return json({ error: "Checkpoint payload not found." }, 404);
      const bytes = await object.arrayBuffer();
      const actualHash = await sha256(bytes);
      const expectedSize = Number(object.customMetadata?.size);
      if (
        !/^[a-f0-9]{64}$/.test(object.customMetadata?.sha256 || "") ||
        actualHash !== object.customMetadata.sha256 ||
        !Number.isSafeInteger(expectedSize) ||
        expectedSize !== bytes.byteLength
      ) {
        return json({ error: "Checkpoint payload integrity verification failed." }, 500);
      }
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(bytes.byteLength),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-checkpoint-sha256": actualHash,
        },
      });
    }
    if (request.method === "DELETE") {
      const object = await bucket.get(key);
      if (!object) return json({ ok: true, deleted: false });
      if (object.customMetadata?.tenant !== tenant) return json({ error: "Checkpoint payload not found." }, 404);
      await bucket.delete(key);
      return json({ ok: true, deleted: true });
    }
  }

  return json({ error: "Checkpoint object route not found or method not allowed." }, 404);
}

export const checkpointObjectInternals = { MAX_OBJECT_BYTES, objectKey, safeSegment };
