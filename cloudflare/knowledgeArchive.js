// Durable archive for public web-search evidence. Never store user prompts or private data.
async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publisherFromUrl(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return "unknown"; }
}

export async function archiveResearchResults(database, result, checkedAt = new Date().toISOString()) {
  if (!database) return { status: "disabled", storedSources: 0, storedChunks: 0 };
  if (!result || result.status !== "ok" || !Array.isArray(result.sources) || result.sources.length === 0) {
    return { status: "skipped", storedSources: 0, storedChunks: 0 };
  }

  let storedSources = 0;
  let storedChunks = 0;
  try {
    for (const source of result.sources.slice(0, 5)) {
      if (!source || typeof source.url !== "string" || !/^https?:\/\//i.test(source.url)) continue;
      const url = new URL(source.url);
      if (url.username || url.password) continue;
      const canonicalUrl = url.href;
      const title = String(source.title || canonicalUrl).slice(0, 240);
      const snippet = String(source.snippet || "").trim().slice(0, 700);
      const sourceId = await sha256(canonicalUrl);
      const contentHash = snippet ? await sha256(snippet) : null;

      await database.prepare(
        `INSERT INTO knowledge_sources
          (id, canonical_url, title, publisher, content_hash, first_seen_at, last_seen_at, verification_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'snippet_only')
         ON CONFLICT(canonical_url) DO UPDATE SET
           title = excluded.title,
           content_hash = COALESCE(excluded.content_hash, knowledge_sources.content_hash),
           last_seen_at = excluded.last_seen_at,
           verification_status = 'snippet_only'`
      ).bind(sourceId, canonicalUrl, title, publisherFromUrl(canonicalUrl), contentHash, checkedAt, checkedAt).run();
      storedSources += 1;

      if (snippet && contentHash) {
        const chunkId = await sha256(sourceId + ":" + contentHash);
        await database.prepare(
          `INSERT OR IGNORE INTO knowledge_chunks
            (id, source_id, chunk_index, content, content_hash, created_at)
           VALUES (?, ?, 0, ?, ?, ?)`
        ).bind(chunkId, sourceId, snippet, contentHash, checkedAt).run();
        storedChunks += 1;
      }
    }
    return { status: "stored", storedSources, storedChunks };
  } catch {
    // Archiving is best-effort: a D1 outage must not break a valid chat response.
    return { status: "unavailable", storedSources, storedChunks };
  }
}
