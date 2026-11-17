const LIVE_MODEL = "models/gemini-3.8-live";
const LIVE_SOCKET = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function downsampleTo16k(input, sourceRate) {
  if (sourceRate === 16000) return input;
  const ratio = sourceRate / 16000;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

function encodePcm16(floatSamples) {
  const pcm = new Int16Array(floatSamples.length);
  for (let i = 0; i < floatSamples.length; i++) {
    const sample = Math.max(-1, Math.min(1, floatSamples[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return toBase64(new Uint8Array(pcm.buffer));
}

function decodePcm16(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const samples = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
  return samples;
}

export function createGeminiLiveVoice(handlers = {}, environment = globalThis) {
  let socket = null;
  let stream = null;
  let audioContext = null;
  let source = null;
  let processor = null;
  let closed = false;
  let setupTimer = null;
  let nextPlaybackTime = 0;
  let userTurn = "";
  let assistantTurn = "";
  const playbackNodes = new Set();

  function status(message) {
    handlers.onStatus?.(message);
  }

  function stopPlayback() {
    for (const node of playbackNodes) {
      try { node.stop(); } catch {}
      try { node.disconnect(); } catch {}
    }
    playbackNodes.clear();
    nextPlaybackTime = audioContext?.currentTime || 0;
  }

  function playAudio(base64) {
    if (!audioContext || closed) return;
    const samples = decodePcm16(base64);
    if (!samples.length) return;
    const buffer = audioContext.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);
    const node = audioContext.createBufferSource();
    node.buffer = buffer;
    node.connect(audioContext.destination);
    const startAt = Math.max(audioContext.currentTime + 0.02, nextPlaybackTime);
    nextPlaybackTime = startAt + buffer.duration;
    playbackNodes.add(node);
    node.onended = () => {
      playbackNodes.delete(node);
      node.disconnect();
    };
    node.start(startAt);
    status("ATLAS is speaking. You can interrupt naturally.");
  }

  function handleMessage(event) {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) {
      stopPlayback();
      assistantTurn = "";
      status("Listening. You can speak whenever you're ready.");
    }
    const inputText = content.inputTranscription?.text;
    if (inputText) {
      userTurn += inputText;
      handlers.onInputTranscript?.(userTurn);
      status("Listening to your voice…");
    }
    const outputText = content.outputTranscription?.text;
    if (outputText) {
      assistantTurn += outputText;
      handlers.onOutputTranscript?.(assistantTurn);
    }
    for (const part of content.modelTurn?.parts || []) {
      const data = part.inlineData?.data || part.inline_data?.data;
      if (data && String(part.inlineData?.mimeType || part.inline_data?.mime_type || "").startsWith("audio/pcm")) {
        playAudio(data);
      }
    }
    if (content.turnComplete) {
      const completedUser = userTurn.trim();
      const completedAssistant = assistantTurn.trim();
      if (completedUser || completedAssistant) {
        handlers.onTurnComplete?.({ userText: completedUser, assistantText: completedAssistant });
      }
      userTurn = "";
      assistantTurn = "";
      status("Listening. Speak naturally; ATLAS is ready.");
    }
  }

  async function start() {
    if (!environment.navigator?.mediaDevices?.getUserMedia) {
      throw new Error("This browser cannot access the microphone. Open ATLAS over HTTPS in an updated browser.");
    }
    status("Preparing secure ATLAS Live Voice session…");
    const tokenResponse = await environment.fetch("/api/voice-token", { method: "POST", headers: { Accept: "application/json" } });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.token) {
      throw new Error(tokenData.error || "ATLAS could not obtain a temporary Gemini Live voice token.");
    }
    stream = await environment.navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    const AudioContextClass = environment.AudioContext || environment.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser does not support live audio streaming.");
    audioContext = new AudioContextClass({ sampleRate: 16000 });
    await audioContext.resume();
    source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = event => {
      if (closed || socket?.readyState !== 1) return;
      const input = event.inputBuffer.getChannelData(0);
      const samples = downsampleTo16k(input, audioContext.sampleRate);
      socket.send(JSON.stringify({
        realtimeInput: {
          audio: { mimeType: "audio/pcm;rate=16000", data: encodePcm16(samples) }
        }
      }));
    };
    source.connect(processor);
    processor.connect(audioContext.destination);

    const url = LIVE_SOCKET + "?access_token=" + encodeURIComponent(tokenData.token);
    socket = new environment.WebSocket(url);
    await new Promise((resolve, reject) => {
      const fail = error => {
        clearTimeout(setupTimer);
        reject(error instanceof Error ? error : new Error("Gemini Live connection failed."));
      };
      setupTimer = setTimeout(() => fail(new Error("Gemini Live connection timed out. Please retry.")), 20000);
      socket.onopen = () => {
        socket.send(JSON.stringify({
          setup: {
            model: LIVE_MODEL,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } }
            },
            systemInstruction: {
              parts: [{ text: "You are ATLAS, the voice assistant inside the ATLAS application. Speak naturally, clearly, and concisely. Respond to the user's spoken request directly. Do not claim to control devices or perform actions unless a connected tool confirms it. This Live Voice session is only for voice conversations; the user's normal ATLAS text chat and other app features remain separate." }]
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: { automaticActivityDetection: { disabled: false } }
          }
        }));
      };
      socket.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.setupComplete) {
          clearTimeout(setupTimer);
          socket.onmessage = handleMessage;
          status("Connected. Listening for your voice…");
          resolve();
          return;
        }
        if (message.error) fail(new Error(message.error.message || "Gemini Live rejected the session."));
      };
      socket.onerror = () => fail(new Error("Gemini Live connection failed. Check your connection and try again."));
      socket.onclose = event => {
        if (!closed) {
          handlers.onError?.(new Error(event.reason || "The live voice connection closed."));
        }
      };
    });
    return true;
  }

  function stop() {
    if (closed) return;
    closed = true;
    clearTimeout(setupTimer);
    try { processor && (processor.onaudioprocess = null); } catch {}
    try { processor?.disconnect(); } catch {}
    try { source?.disconnect(); } catch {}
    for (const track of stream?.getTracks?.() || []) track.stop();
    stopPlayback();
    try { socket?.close(1000, "Voice session ended"); } catch {}
    try { audioContext?.close(); } catch {}
    socket = null;
    stream = null;
    processor = null;
    source = null;
    audioContext = null;
    status("Voice session ended.");
  }

  return { start, stop };
}
