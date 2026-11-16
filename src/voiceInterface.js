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
  recognition.continuous = true;
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

const britishMaleVoiceName = /google uk english male|microsoft ryan|\b(?:daniel|george|arthur|oliver|ryan)\b|\bmale\b/i;
const femaleVoiceName = /\bfemale\b|\b(?:susan|kate|hazel|samantha|victoria|serena|moira|tessa)\b/i;

export function selectBritishMaleVoice(voices = []) {
  const candidates = voices.filter(voice =>
    /^en-GB(?:-|$)/i.test(voice.lang || "") &&
    !femaleVoiceName.test(voice.name || "") &&
    (voice.gender === "male" || britishMaleVoiceName.test(voice.name || ""))
  );
  return candidates.find(voice => /google uk english male/i.test(voice.name || "")) ||
    candidates.find(voice => /microsoft ryan/i.test(voice.name || "")) ||
    candidates[0] || null;
}

function getVoicesWhenReady(synthesis) {
  const initial = synthesis.getVoices?.() || [];
  if (initial.length) return Promise.resolve(initial);
  return new Promise(resolve => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      synthesis.removeEventListener?.("voiceschanged", finish);
      resolve(synthesis.getVoices?.() || []);
    };
    synthesis.addEventListener?.("voiceschanged", finish, { once: true });
    timer = setTimeout(finish, 1200);
  });
}

export async function speakText(text, environment = globalThis) {
  const capabilities = getVoiceCapabilities(environment);
  if (!capabilities.speechSynthesis) throw new Error("Spoken responses are not supported by this browser.");
  const phrase = cleanTextForSpeech(text);
  if (!phrase) return;
  const voices = await getVoicesWhenReady(environment.speechSynthesis);
  const maleVoice = selectBritishMaleVoice(voices);
  if (!maleVoice) {
    throw new Error("No British male voice is installed or exposed by this device. Enable a British English male voice in Android Text-to-Speech settings; ATLAS will not use a female fallback.");
  }
  return new Promise((resolve, reject) => {
    environment.speechSynthesis.cancel();
    const utterance = new environment.SpeechSynthesisUtterance(phrase);
    utterance.lang = "en-GB";
    utterance.rate = 0.88;
    utterance.pitch = 0.78;
    utterance.voice = maleVoice;
    utterance.onend = () => resolve();
    utterance.onerror = event => reject(new Error(event.error || "Speech playback failed."));
    environment.speechSynthesis.speak(utterance);
  });
}
