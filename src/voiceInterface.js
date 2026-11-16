let activeAudio = null;
let activeController = null;
let activeObjectUrl = null;
let activeReject = null;

export function getVoiceCapabilities(environment = globalThis) {
  const Recognition = environment.SpeechRecognition || environment.webkitSpeechRecognition;
  return {
    speechRecognition: typeof Recognition === "function",
    speechSynthesis: typeof environment.fetch === "function" && typeof environment.Audio === "function"
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

export function stopSpeechPlayback() {
  if (activeController) activeController.abort();
  activeController = null;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.removeAttribute?.("src");
    activeAudio.load?.();
  }
  activeAudio = null;
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = null;
  const reject = activeReject;
  activeReject = null;
  reject?.(new Error("Speech playback interrupted."));
}

export async function speakText(text, environment = globalThis) {
  if (typeof environment.fetch !== "function" || typeof environment.Audio !== "function") {
    throw new Error("Cloud speech playback is not supported by this browser.");
  }
  const phrase = cleanTextForSpeech(text);
  if (!phrase) return;
  stopSpeechPlayback();
  const controller = new AbortController();
  activeController = controller;
  try {
    const response = await environment.fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: phrase }),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || "Cloud speech generation failed (" + response.status + ").");
    }
    const blob = await response.blob();
    if (controller.signal.aborted) throw new Error("Speech playback interrupted.");
    if (!blob.size) throw new Error("The speech service returned empty audio.");
    const objectUrl = (environment.URL || URL).createObjectURL(blob);
    activeObjectUrl = objectUrl;
    const audio = new environment.Audio(objectUrl);
    activeAudio = audio;
    await new Promise((resolve, reject) => {
      activeReject = reject;
      const cleanup = () => {
        if (activeAudio === audio) activeAudio = null;
        if (activeController === controller) activeController = null;
        if (activeObjectUrl === objectUrl) {
          (environment.URL || URL).revokeObjectURL(objectUrl);
          activeObjectUrl = null;
        }
        if (activeReject === reject) activeReject = null;
      };
      audio.onended = () => { cleanup(); resolve(); };
      audio.onerror = () => { cleanup(); reject(new Error("Audio playback failed on this device.")); };
      Promise.resolve(audio.play()).catch(error => {
        cleanup();
        reject(new Error(error?.message || "Audio playback was blocked by the browser."));
      });
    });
  } catch (error) {
    if (activeController === controller) activeController = null;
    if (activeObjectUrl) {
      (environment.URL || URL).revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
    if (controller.signal.aborted) throw new Error("Speech playback interrupted.");
    throw error;
  }
}
