import test from "node:test";
import assert from "node:assert/strict";
import { cleanTextForSpeech, createSpeechRecognition, getVoiceCapabilities, selectBritishMaleVoice, speakText } from "./voiceInterface.js";

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
  assert.equal(recognition.continuous, true);
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
      getVoices: () => [{ lang: "en-US" }, { name: "Microsoft Ryan", lang: "en-GB" }],
      speak(utterance) { spoken = utterance; queueMicrotask(() => utterance.onend()); }
    }
  };
  await speakText("Good afternoon, sir.", environment);
  assert.equal(spoken.lang, "en-GB");
  assert.equal(spoken.voice.lang, "en-GB");
  assert.equal(spoken.rate, 0.88);
});

test("removes markdown markers before speech", () => {
  assert.equal(cleanTextForSpeech(["## Status", "**Ready**", "- First item"].join(String.fromCharCode(10))), "Status Ready First item");
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
  assert.equal(spoken.pitch, 0.78);
});
test("prefers the explicit Google UK English Male voice over other British voices", async () => {
  let spoken;
  class FakeUtterance { constructor(text) { this.text = text; } }
  const environment = {
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: {
      cancel() {},
      getVoices: () => [
        { name: "Microsoft Ryan", lang: "en-GB" },
        { name: "Google UK English Male", lang: "en-GB" },
        { name: "Google UK English Female", lang: "en-GB" }
      ],
      speak(utterance) { spoken = utterance; queueMicrotask(() => utterance.onend()); }
    }
  };
  await speakText("At your service, sir.", environment);
  assert.equal(spoken.voice.name, "Google UK English Male");
  assert.equal(spoken.rate, 0.88);
  assert.equal(spoken.pitch, 0.78);
});


test("never selects a female British voice when no male voice is available", async () => {
  class FakeUtterance { constructor(text) { this.text = text; } }
  const environment = {
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: {
      cancel() {},
      getVoices: () => [
        { name: "Google UK English Female", lang: "en-GB" },
        { name: "English (United Kingdom)", lang: "en-GB" }
      ],
      speak() { throw new Error("A female or unverified voice must never be spoken."); }
    }
  };
  await assert.rejects(speakText("Good evening, sir.", environment), /No British male voice is installed/);
});

test("selects only a positively identified British male voice", () => {
  assert.equal(selectBritishMaleVoice([
    { name: "Google UK English Female", lang: "en-GB" },
    { name: "English (United Kingdom)", lang: "en-GB" },
    { name: "Microsoft Ryan", lang: "en-GB" }
  ]).name, "Microsoft Ryan");
  assert.equal(selectBritishMaleVoice([
    { name: "Google UK English Female", lang: "en-GB" }
  ]), null);
});
