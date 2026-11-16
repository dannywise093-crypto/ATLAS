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

export function cleanTextForSpeech(value) {
  return String(value || "")
    .replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, " ")
    .replace(/\x60([^\x60]+)\x60/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/[\*#_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function speakText(text, environment = globalThis) {
  const capabilities = getVoiceCapabilities(environment);
  if (!capabilities.speechSynthesis) return Promise.reject(new Error("Spoken responses are not supported by this browser."));
  const phrase = cleanTextForSpeech(text);
  if (!phrase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    environment.speechSynthesis.cancel();
    const utterance = new environment.SpeechSynthesisUtterance(phrase);
    utterance.lang = "en-GB";
    utterance.rate = 0.90;
    utterance.pitch = 0.82;
    const voices = environment.speechSynthesis.getVoices?.() || [];
    const britishVoices = voices.filter(voice => /^en-GB(?:-|$)/i.test(voice.lang));
    const preferredVoice = britishVoices.find(voice => /male|daniel|george|oliver|arthur|ryan|brian|guy|andrew|james|thomas/i.test(voice.name || ""));
    utterance.voice = preferredVoice || britishVoices[0] || voices.find(voice => /^en-/i.test(voice.lang)) || null;
    utterance.onend = () => resolve();
    utterance.onerror = event => reject(new Error(event.error || "Speech playback failed."));
    environment.speechSynthesis.speak(utterance);
  });
}
