import { D1CheckpointIndex } from "./checkpoint-index.js";

export async function drainCheckpointGarbage(env) {
  if (!env.RESEARCH_CHECKPOINTS_DB || !env.RESEARCH_CHECKPOINTS_BUCKET) {
    return { processed: 0 };
  }

  const index = new D1CheckpointIndex(env.RESEARCH_CHECKPOINTS_DB);
  const due = await index.listDueGarbage({ limit: 100 });
  let processed = 0;

  for (const item of due) {
    try {
      const prefix = "nexora-checkpoints/" + item.tenant_id + "/";
      if (typeof item.object_key !== "string" || !item.object_key.startsWith(prefix)) {
        continue;
      }
      const referenced = await index.isObjectReferenced({
        tenantId: item.tenant_id,
        objectKey: item.object_key,
      });
      if (!referenced) {
        await env.RESEARCH_CHECKPOINTS_BUCKET.delete(item.object_key);
      }
      await index.removeGarbage({
        tenantId: item.tenant_id,
        objectKey: item.object_key,
      });
      processed += 1;
    } catch {
      // Keep failed rows for the next scheduled retry.
    }
  }

  return { processed };
}
