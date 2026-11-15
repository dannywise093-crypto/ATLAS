import test from "node:test";
import assert from "node:assert/strict";
import { archiveResearchResults } from "./knowledgeArchive.js";

function fakeDatabase({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              if (fail) throw new Error("D1 unavailable");
              calls.push({ sql, params });
              return { success: true };
            },
          };
        },
      };
    },
  };
}

test("archive is disabled cleanly when no D1 binding exists", async () => {
  assert.deepEqual(await archiveResearchResults(null, { status: "ok", sources: [] }), {
    status: "disabled", storedSources: 0, storedChunks: 0,
  });
});

test("archives bounded source metadata and snippets without storing the search prompt", async () => {
  const db = fakeDatabase();
  const result = await archiveResearchResults(db, {
    status: "ok",
    query: "private user prompt must not be persisted",
    sources: [
      { title: "Example", url: "https://www.example.com/page", snippet: "Public source snippet." },
      { title: "Credentials URL", url: "https://user:pass@example.com/private", snippet: "Do not store." },
      { title: "No snippet", url: "https://example.org/" },
    ],
  }, "2026-11-15T00:00:00.000Z");

  assert.deepEqual(result, { status: "stored", storedSources: 2, storedChunks: 1 });
  assert.equal(db.calls.length, 3);
  assert.match(db.calls[0].sql, /INSERT INTO knowledge_sources/);
  assert.match(db.calls[1].sql, /INSERT OR IGNORE INTO knowledge_chunks/);
  assert.equal(db.calls[0].params[3], "example.com");
  assert.equal(db.calls[1].params[3], "Public source snippet.");
  assert.ok(!JSON.stringify(db.calls).includes("private user prompt"));
});

test("does not archive empty or unavailable research", async () => {
  const db = fakeDatabase();
  const result = await archiveResearchResults(db, { status: "unavailable", sources: [] });
  assert.deepEqual(result, { status: "skipped", storedSources: 0, storedChunks: 0 });
  assert.equal(db.calls.length, 0);
});

test("D1 failures are reported without throwing", async () => {
  const db = fakeDatabase({ fail: true });
  const result = await archiveResearchResults(db, {
    status: "ok",
    sources: [{ title: "Example", url: "https://example.com", snippet: "Snippet" }],
  });
  assert.deepEqual(result, { status: "unavailable", storedSources: 0, storedChunks: 0 });
});
