import test from "node:test";
import assert from "node:assert/strict";
import { runAtlasCore } from "./atlasCore.js";

const historyWith = (text) => [{ role: "atlas", text }];

test("recognises a short confirmation follow-up", () => {
  const previous = "I'm ATLAS, a local software foundation.";
  const result = runAtlasCore("Really?", [], historyWith(previous));
  assert.match(result.text, /You're asking me to confirm/);
  assert.match(result.text, /local software foundation/);
});

test("explains the previous reply when asked why", () => {
  const result = runAtlasCore("Why?", [], historyWith("The core runs locally."));
  assert.match(result.text, /The reason I gave that reply/);
  assert.match(result.text, /runs locally/);
});

test("clarifies a previous reply", () => {
  const result = runAtlasCore("Explain that.", [], historyWith("Memory is stored on this device."));
  assert.match(result.text, /In simpler terms/);
  assert.match(result.text, /stored on this device/);
});

test("expands on a previous reply without claiming neural reasoning", () => {
  const result = runAtlasCore("Tell me more", [], historyWith("ATLAS has a local memory feature."));
  assert.match(result.text, /A little more context/);
  assert.match(result.text, /future work/);
});

test("does not invent context when there is no previous ATLAS reply", () => {
  const result = runAtlasCore("Really?", [], []);
  assert.match(result.text, /don't know how to answer that yet/i);
});

test("keeps memory saving available", () => {
  const result = runAtlasCore("Remember that tests are important", [], []);
  assert.equal(result.action, "save_memory");
  assert.equal(result.memory, "tests are important");
});
