import test from "node:test";
import assert from "node:assert/strict";
import {
  formatResearchEvidence,
  needsLiveResearch,
  parseBingRssResults,
  parseSearchResults,
  searchWeb,
} from "./knowledge.js";

test("detects requests needing current information", () => {
  assert.equal(needsLiveResearch("What is the latest version of Python?"), true);
  assert.equal(needsLiveResearch("What is Elon Musk's net worth today?"), true);
  assert.equal(needsLiveResearch("Explain Newton's first law"), false);
});

test("parses DuckDuckGo result links and snippets", () => {
  const html = '<div><a class="result__a" href="https://example.com/article">Example Article</a><a class="result__snippet">A useful source snippet.</a></div>';
  const results = parseSearchResults(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Example Article");
  assert.equal(results[0].url, "https://example.com/article");
  assert.match(results[0].snippet, /useful source/);
});

test("parses Bing RSS items and decodes XML entities", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Latest &amp; useful</title><link>https://example.org/story?a=1&amp;b=2</link><description><![CDATA[Current <b>source</b> summary.]]></description></item>
  </channel></rss>`;
  const results = parseBingRssResults(xml);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Latest & useful");
  assert.equal(results[0].url, "https://example.org/story?a=1&b=2");
  assert.match(results[0].snippet, /Current source summary/);
});

test("rejects non-http links and duplicate DuckDuckGo sources", () => {
  const html = '<a class="result__a" href="javascript:alert(1)">Bad</a><a class="result__a" href="https://example.com/a">A</a><a class="result__a" href="https://example.com/a">A duplicate</a>';
  const results = parseSearchResults(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://example.com/a");
});

test("searchWeb prefers Bing RSS when it returns usable sources", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return new Response('<rss><channel><item><title>Example</title><link>https://example.org</link><description>Evidence snippet</description></item></channel></rss>', {
      status: 200,
      headers: { "Content-Type": "application/rss+xml" },
    });
  };
  const result = await searchWeb("latest science", fakeFetch);
  assert.equal(result.status, "ok");
  assert.equal(result.provider, "Bing RSS");
  assert.equal(result.sources[0].url, "https://example.org/");
  assert.equal(calls, 1);
});

test("searchWeb falls back to DuckDuckGo when Bing returns no results", async () => {
  let calls = 0;
  const fakeFetch = async (url) => {
    calls++;
    if (String(url).includes("bing.com")) return new Response("<rss><channel></channel></rss>", { status: 200 });
    return new Response('<a class="result__a" href="https://example.net">Fallback result</a><a class="result__snippet">Fallback snippet</a>', { status: 200 });
  };
  const result = await searchWeb("current science", fakeFetch);
  assert.equal(result.status, "ok");
  assert.equal(result.provider, "DuckDuckGo HTML");
  assert.equal(result.sources[0].url, "https://example.net/");
  assert.equal(calls, 2);
});

test("searchWeb reports unavailable when both providers fail", async () => {
  const result = await searchWeb("current news", async () => new Response("", { status: 503 }));
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.sources, []);
});

test("evidence includes retrieval time, provider and warning against invented dates", () => {
  const evidence = formatResearchEvidence({
    status: "ok",
    provider: "Bing RSS",
    query: "latest",
    sources: [{ title: "Source", url: "https://example.com", snippet: "Evidence" }],
  }, new Date("2026-11-14T12:00:00.000Z"));
  assert.match(evidence.context, /2026-11-14T12:00:00.000Z/);
  assert.match(evidence.context, /do not invent publication dates/i);
  assert.match(evidence.context, /Bing RSS/);
  assert.equal(evidence.sources.length, 1);
});

test("unavailable research is not represented as verified", () => {
  const evidence = formatResearchEvidence({ status: "unavailable", query: "latest", sources: [] });
  assert.match(evidence.context, /Do not claim that current information was verified/);
  assert.equal(evidence.sources.length, 0);
});
