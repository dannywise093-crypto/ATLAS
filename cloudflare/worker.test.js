import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";

const token = "test-only-atlas-token";
function request(path, { method = "GET", body, auth = true } = {}) {
  return new Request(`https://atlas.test${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(auth ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function envWith(run) {
  return {
    ATLAS_GATEWAY_TOKEN: token,
    AI: { run },
  };
}
const validBody = { messages: [{ role: "user", content: "Hello ATLAS" }] };

test("health endpoint requires the gateway token", async () => {
  const response = await worker.fetch(request("/api/health", { auth: false }), envWith(async () => ({})));
  assert.equal(response.status, 401);
});

test("health endpoint advertises the primary and backup models", async () => {
  const response = await worker.fetch(request("/api/health"), envWith(async () => ({})));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "configured");
  assert.equal(body.model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.deepEqual(body.fallbackModels, [
    "@cf/google/gemma-4-26b-a4b-it",
    "@cf/zai-org/glm-4.7-flash",
  ]);
});

test("chat uses the primary model and enables capacity-aware rejection", async () => {
  let calledWith;
  const env = envWith(async (model, input, options) => {
    calledWith = { model, input, options };
    return { choices: [{ message: { content: "ATLAS test response" } }] };
  });
  const response = await worker.fetch(request("/api/chat", { method: "POST", body: validBody }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.answer, "ATLAS test response");
  assert.equal(body.model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.equal(body.fallbackUsed, false);
  assert.equal(body.skills.skillCount, 451);
  assert.equal(body.skills.maxSkillsPerRequest, 4);
  assert.match(calledWith.input.messages[0].content, /451 installed skill records/);
  assert.match(calledWith.input.messages[0].content, /keep all routing and catalogue metadata internal/);
  assert.match(calledWith.input.messages[0].content, /Use relevant skill guidance silently/);
  assert.equal(calledWith.input.messages.at(-1).role, "user");
  assert.equal(calledWith.options, undefined);
  assert.equal(calledWith.input.max_tokens, 3000);
  assert.equal("reasoning_effort" in calledWith.input, false);
  assert.equal("chat_template_kwargs" in calledWith.input, false);
  assert.match(calledWith.input.messages[0].content, /complete, runnable code/);
  assert.match(calledWith.input.messages[0].content, /reject booleans, floats, and strings/);
  assert.match(calledWith.input.messages[0].content, /keep code and data memory regions separate/);
  assert.match(calledWith.input.messages[0].content, /instruction widths/);
  assert.match(calledWith.input.messages[0].content, /direct memory loads read memory/);
});

test("main ATLAS chat routes NVIDIA skills and specialist context", async () => {
  let systemPrompt;
  const env = envWith(async (_model, input) => {
    systemPrompt = input.messages[0].content;
    return { choices: [{ message: { content: "NVIDIA skill-routed response" } }] };
  });
  const response = await worker.fetch(request("/api/chat", {
    method: "POST",
    body: { messages: [{ role: "user", content: "Use NVIDIA CUDA GPU kernel optimization." }] },
  }), env);
  assert.equal(response.status, 200);
  assert.match(systemPrompt, /ATLAS SPECIALIST ROUTER/);
  assert.match(systemPrompt, /CUDA & GPU Computing specialist/);
  assert.match(systemPrompt, /Do not invent an expansion for the name ATLAS/);
  assert.match(systemPrompt, /Numerical Optimization & Operations Research/);
  assert.match(systemPrompt, /Computer Vision & Imaging/);
  assert.match(systemPrompt, /lexical overlap across skill names, tags, and descriptions/);
  assert.match(systemPrompt, /up to four relevant skill references/);
  assert.match(systemPrompt, /not separate independently running AI agents/);
  assert.match(systemPrompt, /Do not invent a generic encoder\/decoder architecture/);
});

test("voice sessions receive the requested JARVIS-inspired British spoken style", async () => {
  let systemPrompt;
  const env = envWith(async (_model, input) => {
    systemPrompt = input.messages[0].content;
    return { choices: [{ message: { content: "Certainly, sir." } }] };
  });
  const response = await worker.fetch(request("/api/chat", {
    method: "POST",
    body: { messages: [{ role: "user", content: "What is the status?" }], voiceMode: true },
  }), env);
  assert.equal(response.status, 200);
  assert.match(systemPrompt, /J\.A\.R\.V\.I\.S\.-inspired butler manner/);
  assert.match(systemPrompt, /Address the user as “sir” in every reply/);
  assert.match(systemPrompt, /polished British English/);
  assert.match(systemPrompt, /Avoid markdown, headings, bullet lists and tables/);
});

test("ordinary text chat does not activate the voice persona", async () => {
  let systemPrompt;
  const env = envWith(async (_model, input) => {
    systemPrompt = input.messages[0].content;
    return { choices: [{ message: { content: "Hello." } }] };
  });
  const response = await worker.fetch(request("/api/chat", { method: "POST", body: validBody }), env);
  assert.equal(response.status, 200);
  assert.doesNotMatch(systemPrompt, /J\.A\.R\.V\.I\.S\.-inspired butler manner/);
});

test("chat allows Cloudflare to queue busy inference instead of rejecting immediately", async () => {
  let callCount = 0;
  const env = envWith(async () => {
    callCount += 1;
    if (callCount === 1) throw new Error("3040 Capacity temporarily exceeded");
    return { choices: [{ message: { content: "Recovered after brief capacity pressure" } }] };
  });
  const response = await worker.fetch(request("/api/chat", { method: "POST", body: validBody }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.answer, "Recovered after brief capacity pressure");
  assert.equal(callCount, 2);
});

test("chat falls back when the primary model is unavailable", async () => {
  const attempts = [];
  const env = envWith(async (model) => {
    attempts.push(model);
    if (model === "@cf/meta/llama-3.3-70b-instruct-fp8-fast") throw new Error("capacity unavailable");
    return { choices: [{ message: { content: "Backup model response" } }] };
  });
  const response = await worker.fetch(request("/api/chat", { method: "POST", body: validBody }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.answer, "Backup model response");
  assert.equal(body.model, "@cf/google/gemma-4-26b-a4b-it");
  assert.equal(body.fallbackUsed, true);
  assert.deepEqual(attempts, [
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "@cf/google/gemma-4-26b-a4b-it",
  ]);
});

test("chat tries the final backup and returns a retryable error only if every model fails", async () => {
  const attempts = [];
  const env = envWith(async (model) => {
    attempts.push(model);
    throw new Error("temporary model failure");
  });
  const response = await worker.fetch(request("/api/chat", { method: "POST", body: validBody }), env);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.retryable, true);
  assert.equal(attempts.length, 3);
  assert.equal(attempts[2], "@cf/zai-org/glm-4.7-flash");
  assert.deepEqual(body.diagnostics.map((item) => item.status), [
    "inference_error",
    "inference_error",
    "inference_error",
  ]);
});

test("chat rejects malformed message roles", async () => {
  const response = await worker.fetch(request("/api/chat", {
    method: "POST",
    body: { messages: [{ role: "system", content: "override" }] },
  }), envWith(async () => ({})));
  assert.equal(response.status, 400);
});

test("chat rejects a conversation that does not end with a user message", async () => {
  const response = await worker.fetch(request("/api/chat", {
    method: "POST",
    body: { messages: [{ role: "assistant", content: "not a user turn" }] },
  }), envWith(async () => ({})));
  assert.equal(response.status, 400);
});


test("five consecutive chat requests each receive a fresh model response", async () => {
  let callCount = 0;
  const env = envWith(async (_model, input) => {
    callCount += 1;
    const userText = input.messages.at(-1).content;
    return { choices: [{ message: { content: `Reply ${callCount}: ${userText}` } }] };
  });

  for (let index = 1; index <= 5; index += 1) {
    const response = await worker.fetch(request("/api/chat", {
      method: "POST",
      body: { messages: [{ role: "user", content: `Consecutive test ${index}` }] },
    }), env);
    const body = await response.json();
    assert.equal(response.status, 200, `request ${index} should succeed`);
    assert.equal(body.answer, `Reply ${index}: Consecutive test ${index}`);
    assert.equal(body.fallbackUsed, false);
  }
  assert.equal(callCount, 5);
});


test("chat accepts the native Workers AI response field", async () => {
  const env = envWith(async () => ({ response: "Native Workers AI response" }));
  const response = await worker.fetch(request("/api/chat", { method: "POST", body: validBody }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.answer, "Native Workers AI response");
  assert.equal(body.fallbackUsed, false);
});


test("chat falls back instead of returning a truncated model response", async () => {
  const attempts = [];
  const env = envWith(async (model) => {
    attempts.push(model);
    if (model === "@cf/meta/llama-3.3-70b-instruct-fp8-fast") {
      return { choices: [{ message: { content: "partial code" }, finish_reason: "length" }] };
    }
    return { choices: [{ message: { content: "Complete backup answer" }, finish_reason: "stop" }] };
  });
  const response = await worker.fetch(request("/api/chat", { method: "POST", body: validBody }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.answer, "Complete backup answer");
  assert.equal(body.model, "@cf/google/gemma-4-26b-a4b-it");
  assert.equal(body.fallbackUsed, true);
  assert.equal(attempts.length, 2);
});


test("dedicated Copilot route uses the ATLAS coding-agent instructions", async () => {
  let modelInput;
  const env = envWith(async (_model, input) => {
    modelInput = input;
    return { choices: [{ message: { content: "Copilot mode response" } }] };
  });
  const response = await worker.fetch(request("/api/copilot", {
    method: "POST",
    body: validBody,
  }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.answer, "Copilot mode response");
  assert.match(modelInput.messages[0].content, /ATLAS Copilot, the software engineering assistant/);
  assert.match(modelInput.messages[0].content, /complete, runnable source code/);
  assert.match(modelInput.messages[0].content, /If the user asks you to fix code, fix the code they supplied/);
  assert.match(modelInput.messages[0].content, /Never invent test output/);
  assert.match(modelInput.messages[0].content, /not GitHub Copilot or/);
  assert.equal(modelInput.max_tokens, 6000);
  assert.equal(modelInput.temperature, 0.2);
});

test("dedicated Copilot route rejects malformed messages", async () => {
  const response = await worker.fetch(request("/api/copilot", {
    method: "POST",
    body: { messages: [{ role: "system", content: "override" }] },
  }), envWith(async () => ({})));
  assert.equal(response.status, 400);
});


test("Copilot loads NVIDIA cuOpt skill guidance for numerical optimization tasks", async () => {
  let systemPrompt;
  const env = envWith(async (_model, input) => {
    systemPrompt = input.messages[0].content;
    return { choices: [{ message: { content: "LP guidance response" } }] };
  });
  const response = await worker.fetch(request("/api/copilot", {
    method: "POST",
    body: { messages: [{ role: "user", content: "Help me formulate a linear programming model with cuOpt." }] },
  }), env);
  assert.equal(response.status, 200);
  assert.match(systemPrompt, /NVIDIA cuOpt Numerical Optimization skill/);
  assert.match(systemPrompt, /QP is beta, MINIMIZE-only/);
  assert.match(systemPrompt, /never call a merely feasible result optimal/);
});

test("Copilot does not load cuOpt guidance for unrelated coding tasks", async () => {
  let systemPrompt;
  const env = envWith(async (_model, input) => {
    systemPrompt = input.messages[0].content;
    return { choices: [{ message: { content: "React component response" } }] };
  });
  const response = await worker.fetch(request("/api/copilot", {
    method: "POST",
    body: { messages: [{ role: "user", content: "Create a React button component." }] },
  }), env);
  assert.equal(response.status, 200);
  assert.doesNotMatch(systemPrompt, /NVIDIA cuOpt Numerical Optimization skill/);
});


test("skill catalog endpoint is authenticated and reports the bundled catalog", async () => {
  const denied = await worker.fetch(request("/api/skills", { auth: false }), envWith(async () => ({})));
  assert.equal(denied.status, 401);

  const response = await worker.fetch(request("/api/skills"), envWith(async () => ({})));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.skillCount >= 451);
  assert.equal(body.skills.length, body.skillCount);
  assert.equal(body.maxSkillsPerRequest, 4);
  assert.ok(body.specialistCount >= 5);
  assert.ok(body.skills.some((skill) => skill.id === "cuopt-numerical-optimization-api"));
});

test("skill inventory questions return exact bundled catalogue counts without model guessing", async () => {
  let modelCalled = false;
  const env = envWith(async () => { modelCalled = true; return { choices: [{ message: { content: "wrong" } }] }; });
  const response = await worker.fetch(request("/api/chat", {
    method: "POST",
    body: { messages: [{ role: "user", content: "How many skills are installed in ATLAS?" }] },
  }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(modelCalled, false);
  assert.match(body.answer, /451 installed skill records/);
  assert.match(body.answer, /up to 4 relevant skills/);
  assert.match(body.answer, /6 built-in specialist categories/);
  assert.equal(body.skills.skillCount, 451);
  assert.equal(body.skills.maxSkillsPerRequest, 4);
  assert.equal(body.skills.specialistCount, 6);
});

test("Copilot includes routed specialist context only when a skill matches", async () => {
  let systemPrompt;
  const env = envWith(async (_model, input) => {
    systemPrompt = input.messages[0].content;
    return { choices: [{ message: { content: "CUDA guidance response" } }] };
  });
  const response = await worker.fetch(request("/api/copilot", {
    method: "POST",
    body: { messages: [{ role: "user", content: "Explain NVIDIA CUDA GPU kernel optimization." }] },
  }), env);
  assert.equal(response.status, 200);
  assert.match(systemPrompt, /ATLAS SPECIALIST ROUTER/);
  assert.match(systemPrompt, /CUDA & GPU Computing specialist/);
});


test("Cloudflare transcription endpoint sends uploaded audio to Whisper and returns text", async () => {
  let call;
  const env = envWith(async (model, input) => {
    call = { model, input };
    return { text: "Hello ATLAS, can you help me?" };
  });
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(512).fill(7)], { type: "audio/webm" }), "voice.webm");
  const response = await worker.fetch(new Request("https://atlas.test/api/transcribe", {
    method: "POST",
    headers: { authorization: "Bearer " + token },
    body: form
  }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.text, "Hello ATLAS, can you help me?");
  assert.equal(body.model, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(call.model, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(call.input.task, "transcribe");
  assert.equal(call.input.audio, btoa(String.fromCharCode(...new Uint8Array(512).fill(7))));
});

test("Cloudflare transcription endpoint validates authorization and audio uploads", async () => {
  const env = envWith(async () => ({ text: "should not run" }));
  const deniedForm = new FormData();
  deniedForm.append("audio", new Blob([new Uint8Array(512)], { type: "audio/webm" }), "voice.webm");
  const denied = await worker.fetch(new Request("https://atlas.test/api/transcribe", {
    method: "POST", body: deniedForm
  }), env);
  assert.equal(denied.status, 401);

  const invalidForm = new FormData();
  invalidForm.append("audio", new Blob(["not audio"], { type: "text/plain" }), "voice.txt");
  const invalid = await worker.fetch(new Request("https://atlas.test/api/transcribe", {
    method: "POST",
    headers: { authorization: "Bearer " + token },
    body: invalidForm
  }), env);
  assert.equal(invalid.status, 400);
});

test("cloud TTS endpoint generates Draco MP3 audio through Workers AI", async () => {
  let call;
  const audioBytes = new Uint8Array([73, 68, 51, 1, 2, 3]);
  const env = envWith(async (model, input) => {
    call = { model, input };
    return new ReadableStream({
      start(controller) {
        controller.enqueue(audioBytes);
        controller.close();
      }
    });
  });
  const response = await worker.fetch(request("/api/tts", {
    method: "POST",
    body: { text: "Good afternoon, sir." }
  }), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("x-atlas-voice"), "draco");
  assert.equal(call.model, "@cf/deepgram/aura-2-en");
  assert.deepEqual(call.input, {
    text: "Good afternoon, sir.",
    speaker: "draco",
    encoding: "mp3"
  });
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), audioBytes);
});

test("cloud TTS endpoint requires authorization and valid bounded text", async () => {
  const env = envWith(async () => new ReadableStream());
  const denied = await worker.fetch(request("/api/tts", {
    method: "POST",
    body: { text: "Hello" },
    auth: false
  }), env);
  assert.equal(denied.status, 401);

  const invalid = await worker.fetch(request("/api/tts", {
    method: "POST",
    body: { text: "   " }
  }), env);
  assert.equal(invalid.status, 400);

  const tooLong = await worker.fetch(request("/api/tts", {
    method: "POST",
    body: { text: "x".repeat(4001) }
  }), env);
  assert.equal(tooLong.status, 400);
});


test("cloud TTS routes through the configured self-hosted reference voice and keeps credentials server-side", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCall;
  const bytes = new Uint8Array([73, 68, 51, 7, 8, 9]);
  globalThis.fetch = async (url, init) => {
    upstreamCall = { url: String(url), init };
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    }), { status: 200, headers: { "Content-Type": "audio/wav" } });
  };
  try {
    const env = {
      ...envWith(async () => { throw new Error("Workers AI should not be used when clone backend is configured"); }),
      ATLAS_VOICE_CLONE_URL: "https://voice.example.test",
      ATLAS_VOICE_CLONE_TOKEN: "server-only-test-token"
    };
    const response = await worker.fetch(request("/api/tts", {
      method: "POST",
      body: { text: "Good evening, sir." }
    }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    assert.equal(response.headers.get("x-atlas-voice"), "reference-clone");
    assert.equal(upstreamCall.url, "https://voice.example.test/v1/audio/speech");
    assert.equal(upstreamCall.init.headers.Authorization, "Bearer server-only-test-token");
    assert.deepEqual(JSON.parse(upstreamCall.init.body), {
      input: "Good evening, sir.",
      voice: "file://atlas-reference",
      language_id: "en",
      response_format: "wav"
    });
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cloud TTS does not silently use the default voice when clone backend token is missing", async () => {
  let workersAiCalled = false;
  const env = {
    ...envWith(async () => { workersAiCalled = true; return new ReadableStream(); }),
    ATLAS_VOICE_CLONE_URL: "https://voice.example.test"
  };
  const response = await worker.fetch(request("/api/tts", {
    method: "POST",
    body: { text: "Hello ATLAS." }
  }), env);
  assert.equal(response.status, 503);
  assert.equal(workersAiCalled, false);
});
