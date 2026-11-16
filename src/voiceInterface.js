export function getVoiceCapabilities(environment = globalThis) {
  const Recognition = environment.SpeechRecognition || environment.webkitSpeechRecognition;
  return {
    speechRecognition: typeof Recognition === "function",
    speechSynthesis: Boolean(environment.speechSynthesis && typeof environment.SpeechSynthesisUtterance === "function")
  };
}

export function createSpeechRecognition(environment = globalThis, handlers = {}) {
  const Recognition = environment.SpeechRecognition || environment.webkitSpeechRecognition;
  if (typeof Recognition !== "function") throw new Error("Speech recognition is not supported by this browser.");
  const recognition = new Recognition();
  recognition.lang = "en-GB";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onresult = event => handlers.onResult?.(event);
  recognition.onerror = event => handlers.onError?.(event);
  recognition.onend = () => handlers.onEnd?.();
  return recognition;
}

export function speakText(text, environment = globalThis) {
  const capabilities = getVoiceCapabilities(environment);
  if (!capabilities.speechSynthesis) return Promise.reject(new Error("Spoken responses are not supported by this browser."));
  const phrase = String(text || "").trim();
  if (!phrase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    environment.speechSynthesis.cancel();
    const utterance = new environment.SpeechSynthesisUtterance(phrase);
    utterance.lang = "en-GB";
    utterance.rate = 0.94;
    utterance.pitch = 0.96;
    const voices = environment.speechSynthesis.getVoices?.() || [];
    utterance.voice = voices.find(voice => /^en-GB$/i.test(voice.lang)) || voices.find(voice => /^en-/i.test(voice.lang)) || null;
    utterance.onend = () => resolve();
    utterance.onerror = event => reject(new Error(event.error || "Speech playback failed."));
    environment.speechSynthesis.speak(utterance);
  });
}
