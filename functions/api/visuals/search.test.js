import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "./search.js";

test("visual search returns Commons images with creator and license attribution", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    assert.equal(parsed.hostname, "commons.wikimedia.org");
    return Response.json({ query: { pages: [{
      title: "File:Water cycle diagram.jpg",
      imageinfo: [{
        thumburl: "https://upload.wikimedia.org/thumb.jpg",
        descriptionurl: "https://commons.wikimedia.org/wiki/File:Water_cycle_diagram.jpg",
        extmetadata: {
          ObjectName: { value: "Water cycle diagram" },
          Artist: { value: "Example Author" },
          LicenseShortName: { value: "CC BY-SA 4.0" },
          LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" }
        }
      }]
    }] } });
  };
  try {
    const response = await onRequestGet({ request: new Request("https://nexora.test/api/visuals/search?q=water%20cycle") });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.images[0].author, "Example Author");
    assert.equal(body.images[0].license, "CC BY-SA 4.0");
    assert.equal(body.images[0].sourceUrl, "https://commons.wikimedia.org/wiki/File:Water_cycle_diagram.jpg");
  } finally { globalThis.fetch = originalFetch; }
});

test("visual search rejects empty and restricted topic queries before network access", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("must not fetch"); };
  try {
    const empty = await onRequestGet({ request: new Request("https://nexora.test/api/visuals/search?q=") });
    assert.equal(empty.status, 400);
    const blocked = await onRequestGet({ request: new Request("https://nexora.test/api/visuals/search?q=firearm") });
    assert.equal(blocked.status, 400);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});
