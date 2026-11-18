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


test("mobile voice recording starts with a short audio timeslice after explicit permission", async () => {
  const frames = [];
  let recorderStartTimeslice = null;
  let stoppedTracks = false;
  class FakeRecorder {
    static isTypeSupported() { return true; }
    constructor(_stream, options) { this.mimeType = options.mimeType; this.state = "inactive"; }
    start(timeslice) { recorderStartTimeslice = timeslice; this.state = "recording"; }
    stop() { this.state = "inactive"; this.onstop?.(); }
  }
  class FakeAudioContext {
    async resume() {}
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() {
      return {
        fftSize: 0,
        smoothingTimeConstant: 0,
        getByteTimeDomainData(buffer) { buffer.fill(150); },
        connect() {}
      };
    }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    async close() {}
  }
  const environment = {
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop() { stoppedTracks = true; } }]
        })
      }
    },
    MediaRecorder: FakeRecorder,
    AudioContext: FakeAudioContext,
    FormData,
    Blob,
    fetch: async () => ({ ok: true, json: async () => ({ text: "" }) }),
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout
  };
  const session = createCloudflareVoice({}, environment);
  await session.start();
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(recorderStartTimeslice, 250);
  session.stop();
  assert.equal(stoppedTracks, true);
});
