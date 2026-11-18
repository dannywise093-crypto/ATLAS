const SPEECH_THRESHOLD = 0.018;
const SILENCE_MS = 1100;
const MAX_SEGMENT_MS = 12_000;
const MIN_SEGMENT_MS = 450;

function supportedMimeType(MediaRecorderClass) {
  const choices = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return choices.find(type => MediaRecorderClass.isTypeSupported?.(type)) || "";
}

/**
 * Opt-in, Cloudflare-backed voice interaction.
 * The browser only captures microphone audio; transcription, reasoning and
 * speech generation are performed by ATLAS Cloudflare services.
 */
export function createCloudflareVoice(handlers = {}, environment = globalThis) {
  let stream = null;
  let audioContext = null;
  let analyser = null;
  let recorder = null;
  let chunks = [];
  let frameId = null;
  let closed = false;
  let paused = false;
  let transcribing = false;
  let segmentStartedAt = 0;
  let silenceStartedAt = 0;
  let sampleBuffer = null;

  function status(message) {
    handlers.onStatus?.(message);
  }

  function scheduleFrame(callback) {
    if (typeof environment.requestAnimationFrame === "function") {
      frameId = environment.requestAnimationFrame(callback);
    } else {
      frameId = environment.setTimeout(() => callback(Date.now()), 50);
    }
  }

  function cancelFrame() {
    if (frameId === null) return;
    if (typeof environment.cancelAnimationFrame === "function") environment.cancelAnimationFrame(frameId);
    else environment.clearTimeout(frameId);
    frameId = null;
  }

  async function transcribe(blob) {
    if (closed || blob.size < 256) return;
    transcribing = true;
    status("Transcribing your voice securely with Cloudflare…");
    try {
      const form = new environment.FormData();
      const extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
      form.append("audio", blob, "atlas-voice." + extension);
      const response = await environment.fetch("/api/transcribe", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Cloudflare voice transcription failed (" + response.status + ").");
      const transcript = typeof data.text === "string" ? data.text.trim() : "";
      if (transcript && !closed) await handlers.onTranscript?.(transcript);
      else if (!closed) status("Listening. Speak whenever you're ready.");
    } catch (error) {
      if (!closed) {
        handlers.onError?.(error);
        status("Voice transcription failed. Please try speaking again.");
      }
    } finally {
      transcribing = false;
    }
  }

  function finishSegment() {
    if (!recorder || recorder.state === "inactive") return;
    const current = recorder;
    recorder = null;
    transcribing = true;
    current.onstop = () => {
      const blob = new environment.Blob(chunks, { type: current.mimeType || "audio/webm" });
      chunks = [];
      if (!closed && !paused && Date.now() - segmentStartedAt >= MIN_SEGMENT_MS) {
        void transcribe(blob);
      } else {
        transcribing = false;
      }
    };
    current.stop();
    silenceStartedAt = 0;
  }

  function beginSegment() {
    if (closed || paused || transcribing || recorder || !stream) return;
    const MediaRecorderClass = environment.MediaRecorder;
    const mimeType = supportedMimeType(MediaRecorderClass);
    try {
      recorder = mimeType
        ? new MediaRecorderClass(stream, { mimeType })
        : new MediaRecorderClass(stream);
      chunks = [];
      segmentStartedAt = Date.now();
      silenceStartedAt = 0;
      recorder.ondataavailable = event => {
        if (event.data?.size) chunks.push(event.data);
      };
      recorder.onerror = event => handlers.onError?.(event.error || new Error("Microphone recording failed."));
      recorder.start();
      status("Listening. Speak naturally…");
    } catch (error) {
      recorder = null;
      handlers.onError?.(error);
    }
  }

  function measureVoice() {
    if (closed) return;
    if (!paused && !transcribing && analyser && sampleBuffer) {
      analyser.getByteTimeDomainData(sampleBuffer);
      let energy = 0;
      for (let i = 0; i < sampleBuffer.length; i++) {
        const sample = (sampleBuffer[i] - 128) / 128;
        energy += sample * sample;
      }
      const level = Math.sqrt(energy / sampleBuffer.length);
      const now = Date.now();
      if (!recorder && level >= SPEECH_THRESHOLD) beginSegment();
      if (recorder) {
        if (level < SPEECH_THRESHOLD) {
          if (!silenceStartedAt) silenceStartedAt = now;
          if (now - silenceStartedAt >= SILENCE_MS || now - segmentStartedAt >= MAX_SEGMENT_MS) finishSegment();
        } else {
          silenceStartedAt = 0;
          if (now - segmentStartedAt >= MAX_SEGMENT_MS) finishSegment();
        }
      }
    }
    scheduleFrame(measureVoice);
  }

  async function start() {
    if (!environment.navigator?.mediaDevices?.getUserMedia) {
      throw new Error("This browser cannot access the microphone. Open ATLAS over HTTPS in an updated browser.");
    }
    if (typeof environment.MediaRecorder !== "function") {
      throw new Error("This browser does not support audio recording for Cloudflare voice.");
    }
    const AudioContextClass = environment.AudioContext || environment.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser does not support microphone audio analysis.");
    status("Requesting microphone access. Your microphone stays off until this step…");
    stream = await environment.navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    try {
      audioContext = new AudioContextClass();
      await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      sampleBuffer = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      closed = false;
      paused = false;
      status("Connected to Cloudflare voice. Listening…");
      scheduleFrame(measureVoice);
      return true;
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
      throw error;
    }
  }

  function pause() {
    paused = true;
    if (recorder) finishSegment();
  }

  function resume() {
    if (closed) return;
    paused = false;
    status("Listening. Speak whenever you're ready.");
  }

  function stop() {
    if (closed) return;
    closed = true;
    paused = true;
    cancelFrame();
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try { recorder.stop(); } catch {}
    }
    recorder = null;
    chunks = [];
    for (const track of stream?.getTracks?.() || []) track.stop();
    stream = null;
    try { audioContext?.close(); } catch {}
    audioContext = null;
    analyser = null;
    sampleBuffer = null;
    status("Voice session ended. The microphone is off.");
  }

  return { start, pause, resume, stop };
}
