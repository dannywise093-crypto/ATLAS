import test from "node:test";
import assert from "node:assert/strict";
import { cleanTextForSpeech, createSpeechRecognition, getVoiceCapabilities, speakText } from "./voiceInterface.js";

class FakeRecognition {
  start() { this.started = true; }
  stop() { this.stopped = true; }
}

test("detects speech recognition and spoken response support independently", () => {
  assert.deepEqual(getVoiceCapabilities({ SpeechRecognition: FakeRecognition, speechSynthesis: {}, SpeechSynthesisUtterance: class {} }), {
    speechRecognition: true, speechSynthesis: true
  });
  assert.deepEqual(getVoiceCapabilities({}), { speechRecognition: false, speechSynthesis: false });
});

test("creates an English UK recognition session with final-result handling", () => {
  let received;
  const recognition = createSpeechRecognition({ SpeechRecognition: FakeRecognition }, { onResult: event => { received = event; } });
  assert.equal(recognition.lang, "en-GB");
  assert.equal(recognition.continuous, false);
  assert.equal(recognition.interimResults, true);
  const event = { resultIndex: 0, results: [] };
  recognition.onresult(event);
  assert.equal(received, event);
});

test("reports unsupported recognition and speech synthesis clearly", async () => {
  assert.throws(() => createSpeechRecognition({}), /not supported/);
  await assert.rejects(speakText("Hello", {}), /not supported/);
});

test("speaks using a British English voice when one is available", async () => {
  let spoken;
  class FakeUtterance { constructor(text) { this.text = text; } }
  const environment = {
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: {
      cancel() {},
      getVoices: () => [{ lang: "en-US" }, { lang: "en-GB" }],
      speak(utterance) { spoken = utterance; queueMicrotask(() => utterance.onend()); }
    }
  };
  await speakText("Good afternoon, sir.", environment);
  assert.equal(spoken.lang, "en-GB");
  assert.equal(spoken.voice.lang, "en-GB");
  assert.equal(spoken.rate, 0.94);
});

test("removes markdown markers before speech", () => {
  assert.equal(cleanTextForSpeech("## Status\\n**Ready**\\n- First item"), "Status Ready First item");
});

test("prefers a named British male voice when available", async () => {
  let spoken;
  class FakeUtterance { constructor(text) { this.text = text; } }
  const environment = {
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: {
      cancel() {},
      getVoices: () => [{ name: "Google UK English Female", lang: "en-GB" }, { name: "Microsoft Ryan", lang: "en-GB" }],
      speak(utterance) { spoken = utterance; queueMicrotask(() => utterance.onend()); }
    }
  };
  await speakText("Certainly, sir.", environment);
  assert.equal(spoken.voice.name, "Microsoft Ryan");
  assert.equal(spoken.pitch, 0.82);
});
