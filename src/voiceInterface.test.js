import test from "node:test";
import assert from "node:assert/strict";
import { cleanTextForSpeech, createSpeechRecognition, getVoiceCapabilities, speakText, stopSpeechPlayback } from "./voiceInterface.js";

class FakeRecognition {
  start() { this.started = true; }
  stop() { this.stopped = true; }
}

test("detects browser recognition and cloud audio playback support independently", () => {
  assert.deepEqual(getVoiceCapabilities({ SpeechRecognition: FakeRecognition, fetch() {}, Audio: class {} }), {
    speechRecognition: true, speechSynthesis: true
  });
  assert.deepEqual(getVoiceCapabilities({}), { speechRecognition: false, speechSynthesis: false });
});

test("creates a one-turn English UK recognition session without starting the microphone", () => {
  let received;
  let started;
  const recognition = createSpeechRecognition({ SpeechRecognition: FakeRecognition }, { onStart: event => { started = event; }, onResult: event => { received = event; } });
  assert.equal(recognition.lang, "en-GB");
  assert.equal(recognition.continuous, false);
  assert.equal(recognition.started, undefined);
  const startEvent = { type: "start" };
  recognition.onstart(startEvent);
  recognition.start();
  assert.equal(recognition.started, true);
  assert.equal(started, startEvent);
  assert.equal(recognition.interimResults, true);
  const event = { resultIndex: 0, results: [] };
  recognition.onresult(event);
  assert.equal(received, event);
});

test("reports unsupported recognition and cloud playback clearly", async () => {
  assert.throws(() => createSpeechRecognition({}), /not supported/);
  await assert.rejects(speakText("Hello", {}), /not supported/);
});

test("sends speech to the cloud TTS endpoint and plays returned audio", async () => {
  let requested;
  let played;
  class FakeAudio {
    constructor(src) { this.src = src; played = this; }
    play() { queueMicrotask(() => this.onended()); return Promise.resolve(); }
    pause() {}
    load() {}
    removeAttribute() {}
  }
  const environment = {
    fetch: async (url, options) => {
      requested = { url, options };
      return { ok: true, blob: async () => new Blob(["fake-mp3"], { type: "audio/mpeg" }) };
    },
    Audio: FakeAudio,
    URL: { createObjectURL: () => "blob:atlas-test", revokeObjectURL() {} }
  };
  await speakText("Good afternoon, sir.", environment);
  assert.equal(requested.url, "/api/tts");
  assert.equal(JSON.parse(requested.options.body).text, "Good afternoon, sir.");
  assert.equal(played.src, "blob:atlas-test");
});

test("surfaces cloud TTS errors rather than silently falling back to a device voice", async () => {
  const environment = {
    fetch: async () => ({ ok: false, status: 503, json: async () => ({ error: "Speech service unavailable." }) }),
    Audio: class {},
    URL
  };
  await assert.rejects(speakText("Hello", environment), /Speech service unavailable/);
});

test("removes markdown markers before speech", () => {
  assert.equal(cleanTextForSpeech(["## Status", "**Ready**", "- First item"].join(String.fromCharCode(10))), "Status Ready First item");
});

test("stopSpeechPlayback is safe when no audio is active", () => {
  assert.doesNotThrow(() => stopSpeechPlayback());
});
