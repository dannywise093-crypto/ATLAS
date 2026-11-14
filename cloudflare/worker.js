const MODELS = [
  // Allow longer coding and reasoning prompts more time on the primary model.
  { id: "@cf/zai-org/glm-4.7-flash", timeoutMs: 20_000 },
  { id: "@cf/google/gemma-4-26b-a4b-it", timeoutMs: 13_000 },
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", timeoutMs: 9_000 },
];
const SYSTEM_PROMPT = `You are ATLAS, a capable general-purpose AI assistant.
Be accurate, clear, and honest about uncertainty. Explain concepts clearly, solve
problems carefully, and ask for missing context when needed. Do not claim to have
used tools, accessed private files, or verified facts unless that happened.
Do not claim consciousness or guaranteed correctness. For real-world or high-impact
actions, prioritize safety and human oversight.

When asked to write or generate code:
- Produce complete, runnable code, not fragments or pseudocode.
- Include every required import, class, function, and entry point.
- Include a small example run and expected output when useful.
- Do not use ellipses, "TODO", or omit implementation sections.
- State dependencies and exact run/test commands.
- For large tasks, deliver a working minimal implementation first and clearly state its limits.
- Check for syntax, edge cases, and consistency before answering.
- For simulators, interpreters, and CPUs, keep code and data memory regions separate unless the design explicitly uses self-modifying code.
- Trace the supplied example instruction by instruction and ensure its claimed final state follows from the implementation.
- Include a maximum-step guard for programs that could loop forever.
- Never claim code was executed or tested unless an execution tool actually ran it.
- Keep instruction widths, opcode formats, operand counts, and program-counter increments consistent throughout CPU/ISA examples.
- Make assertions and expected output agree exactly with the program's actual instruction count and state transitions.`;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 24;
const buckets = new Map();

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...extraHeaders,
    },
  });
}

function authorized(request, env) {
  const expected = env.ATLAS_GATEWAY_TOKEN;
  if (!expected) return false;
  const supplied = request.headers.get("authorization") || "";
  return supplied.startsWith("Bearer ") && supplied.slice(7) === expected;
}

function rateLimited(request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    return false;
  }
  if (bucket.count >= MAX_PER_WINDOW) return true;
  bucket.count += 1;
  if (buckets.size > 4000) {
    for (const [key, value] of buckets) {
      if (now - value.start >= WINDOW_MS) buckets.delete(key);
    }
  }
  return false;
}

function extractAnswer(result) {
  // Accept both OpenAI chat-completion and native Workers AI text outputs.
  const candidates = [
    result?.choices?.[0]?.message?.content,
    result?.response,
    result?.result?.response,
    result?.output_text,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function runModelWithDeadline(env, model, messages, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Model response deadline exceeded.")), timeoutMs);
  });
  try {
    return await Promise.race([
      env.AI.run(model, {
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 3000,
        temperature: 0.55,
        // GLM-4.7-Flash otherwise may spend its entire token budget in
        // hidden reasoning and return message.content=null.
        reasoning_effort: null,
        chat_template_kwargs: { enable_thinking: false, clear_thinking: true },
      }, { rejectIfBusy: true }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { allow: "GET" });
      if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
      return json({
        service: "ATLAS Cloudflare Workers AI Gateway",
        status: env.AI ? "configured" : "not_configured",
        provider: "Cloudflare Workers AI",
        model: MODELS[0].id,
        fallbackModels: MODELS.slice(1).map((model) => model.id),
      });
    }

    if (url.pathname !== "/api/chat") return json({ error: "Not found." }, 404);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
    if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
    if (rateLimited(request)) return json({ error: "Too many requests. Please wait and try again." }, 429, { "retry-after": "60" });

    const length = Number(request.headers.get("content-length") || 0);
    if (length > 64 * 1024) return json({ error: "Request body is too large." }, 413);
    let body;
    try { body = await request.json(); } catch { return json({ error: "A valid JSON body is required." }, 400); }
    if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 24) {
      return json({ error: "Provide between 1 and 24 messages." }, 400);
    }
    const messages = [];
    for (const item of body.messages) {
      if (!item || !["user", "assistant"].includes(item.role) ||
          typeof item.content !== "string" || !item.content.trim() || item.content.length > 12000) {
        return json({ error: "A message has an invalid role or content." }, 400);
      }
      messages.push({ role: item.role, content: item.content });
    }
    if (messages[messages.length - 1].role !== "user") {
      return json({ error: "The latest message must be from the user." }, 400);
    }

    const failures = [];
    for (const model of MODELS) {
      try {
        const result = await runModelWithDeadline(env, model.id, messages, model.timeoutMs);
        const answer = extractAnswer(result);
        if (answer) {
          return json({
            answer: answer.trim(),
            model: model.id,
            fallbackUsed: model.id !== MODELS[0].id,
          });
        }
        failures.push(`${model.id}: empty response`);
      } catch (error) {
        failures.push(`${model.id}: ${error?.message || "inference failed"}`);
        console.warn("ATLAS model attempt failed", model.id, error?.message || "unknown error");
      }
    }
    console.error("All ATLAS model attempts failed", failures.join("; "));
    return json({
      error: "ATLAS is temporarily busy. The request was tried against the primary model and backup models. Please retry in a moment.",
      retryable: true,
    }, 503, { "retry-after": "3" });
  },
};
