import test from "node:test";
import assert from "node:assert/strict";
import { createCloudflareVoice } from "./cloudflareVoice.js";

test("creating a Cloudflare voice session does not request microphone access", () => {
  let permissionRequested = false;
  const environment = {
    navigator: { mediaDevices: { getUserMedia: async () => { permissionRequested = true; } } },
    MediaRecorder: class {},
    AudioContext: class {}
  };
  const session = createCloudflareVoice({}, environment);
  assert.equal(permissionRequested, false);
  assert.equal(typeof session.start, "function");
  assert.equal(typeof session.pause, "function");
  assert.equal(typeof session.resume, "function");
  assert.equal(typeof session.stop, "function");
  session.stop();
});

test("Cloudflare voice reports unsupported microphone capture clearly", async () => {
  const session = createCloudflareVoice({}, {});
  await assert.rejects(session.start(), /cannot access the microphone/);
});

test("Cloudflare voice requires MediaRecorder after explicit start", async () => {
  let permissionRequested = false;
  const environment = {
    navigator: { mediaDevices: { getUserMedia: async () => { permissionRequested = true; } } }
  };
  const session = createCloudflareVoice({}, environment);
  await assert.rejects(session.start(), /does not support audio recording/);
  assert.equal(permissionRequested, false);
});
