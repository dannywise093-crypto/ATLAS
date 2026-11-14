import test from "node:test";
import assert from "node:assert/strict";
import { formatResearchEvidence, needsLiveResearch, parseSearchResults, searchWeb } from "./knowledge.js";

test("detects requests needing current information", () => {
  assert.equal(needsLiveResearch("What is the latest version of Python?"), true);
  assert.equal(needsLiveResearch("What is Elon Musk's net worth today?"), true);
  assert.equal(needsLiveResearch("Explain Newton's first law"), false);
});

test("parses result links, snippets and redirect URLs", () => {
  const html = '<div><a class="result__a" href="https://example.com/article">Example Article</a><a class="result__snippet">A useful source snippet.</a></div>';
  const results = parseSearchResults(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Example Article");
  assert.equal(results[0].url, "https://example.com/article");
  assert.match(results[0].snippet, /useful source/);
});

test("rejects non-http links and duplicate sources", () => {
  const html = '<a class="result__a" href="javascript:alert(1)">Bad</a><a class="result__a" href="https://example.com/a">A</a><a class="result__a" href="https://example.com/a">A duplicate</a>';
  const results = parseSearchResults(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://example.com/a");
});

test("searchWeb returns source evidence on successful search", async () => {
  const fakeFetch = async () => new Response('<a class="result__a" href="https://example.org">Example</a>', { status: 200 });
  const result = await searchWeb("latest science", fakeFetch);
  assert.equal(result.status, "ok");
  assert.equal(result.sources[0].url, "https://example.org/");
});

test("searchWeb fails closed when provider is unavailable", async () => {
  const result = await searchWeb("current news", async () => new Response("", { status: 503 }));
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.sources, []);
});

test("evidence includes retrieval time and a warning against invented dates", () => {
  const evidence = formatResearchEvidence({ status: "ok", query: "latest", sources: [{ title: "Source", url: "https://example.com", snippet: "Evidence" }] }, new Date("2026-11-14T12:00:00.000Z"));
  assert.match(evidence.context, /2026-11-14T12:00:00.000Z/);
  assert.match(evidence.context, /do not invent publication dates/i);
  assert.equal(evidence.sources.length, 1);
});

test("unavailable research is not represented as verified", () => {
  const evidence = formatResearchEvidence({ status: "unavailable", query: "latest", sources: [] });
  assert.match(evidence.context, /Do not claim that current information was verified/);
  assert.equal(evidence.sources.length, 0);
});
