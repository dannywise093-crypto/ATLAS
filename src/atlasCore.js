// ATLAS Local Core v0.2
// Transparent on-device assistant foundation. This is deterministic software,
// not a trained language model and not a substitute for professional advice.

const normalize = (value = "") =>
  String(value).toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
const hasAny = (text, terms) => terms.some((term) => text.includes(term));

function memorySearch(query, memories) {
  const terms = normalize(query).split(" ").filter((word) => word.length > 2);
  if (!terms.length) return [];
  return memories.map((note) => ({
    note,
    score: terms.reduce((score, term) => score + (normalize(note).includes(term) ? 1 : 0), 0),
  })).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score).slice(0, 5).map((item) => item.note);
}

function projectPlan() {
  return [
    "ATLAS development plan:",
    "1. Foundation — modular core, reliable local memory and automated tests.",
    "2. Neural runtime — evaluate a small quantized language model on the target phone.",
    "3. Knowledge — document retrieval with source tracking and clear uncertainty.",
    "4. Perception — image and voice input with explicit privacy controls.",
    "5. Evaluation — test reasoning, factuality, speed, battery use and offline behavior.",
    "6. Physical AI — simulation first; hardware only with independent safety controls and supervision.",
    "",
    "The current app is at the foundation stage. Later stages are not yet implemented.",
  ].join("\n");
}

export function runAtlasCore(message, memories = []) {
  const raw = String(message || "").trim();
  const text = normalize(raw);
  if (!text) return { text: "I didn't receive a message. What would you like to work on?" };

  const memoryMatch = raw.match(/^(?:remember that|remember|save this|store this)\s*[:,-]?\s*(.+)$/i);
  if (memoryMatch?.[1]) {
    const note = memoryMatch[1].trim();
    if (memories.some((item) => normalize(item) === normalize(note))) {
      return { text: "That note is already in ATLAS memory on this device." };
    }
    return { action: "save_memory", memory: note, text: `Saved to ATLAS memory on this device: “${note}”` };
  }

  if (hasAny(text, ["hello", "hi atlas", "hey atlas", "good morning", "good afternoon"])) {
    return { text: "Hello. I'm ATLAS Core v0.2, running locally. I can manage project notes, find relevant saved notes and explain the development plan. I'm not yet a general-purpose language model." };
  }
  if (hasAny(text, ["who are you", "what are you", "introduce yourself"])) {
    return { text: "I'm ATLAS, the local software foundation for your personal AI project. This version uses transparent, hand-written logic rather than a trained neural language model. I do not call an external AI service." };
  }
  if (hasAny(text, ["what do you remember", "show memory", "list memories", "my memories"])) {
    return { text: memories.length
      ? "Project notes stored on this device:\n" + memories.map((item, index) => `${index + 1}. ${item}`).join("\n")
      : "No project notes are saved yet. Say “Remember that ...” to add one." };
  }
  if (text.startsWith("find ") || text.startsWith("search memory for ") || text.startsWith("do you remember ")) {
    const query = text.replace(/^(find|search memory for|do you remember)\s+/, "");
    const matches = memorySearch(query, memories);
    return { text: matches.length
      ? "I found these related notes:\n" + matches.map((item, index) => `${index + 1}. ${item}`).join("\n")
      : "I couldn't find a matching note in local memory. I only search notes saved in this app; I don't search the internet." };
  }
  if (hasAny(text, ["roadmap", "development plan", "what should we build next", "project plan"])) {
    return { text: projectPlan() };
  }
  if (hasAny(text, ["help", "what can you do", "capabilities", "commands"])) {
    return { text: [
      "ATLAS Core v0.2 can:",
      "• Save project notes: “Remember that ...”",
      "• List saved notes: “What do you remember?”",
      "• Search saved notes: “Find phone hardware”.",
      "• Explain its identity, limitations and development roadmap.",
      "",
      "Not implemented: open-ended neural conversation, web search, image understanding, speech recognition, model training or robot control.",
    ].join("\n") };
  }
  if (hasAny(text, ["offline", "internet", "without internet", "local ai"])) {
    return { text: "This rule-based core runs on-device without an AI server. A neural language model could also run locally if it fits the phone's available physical memory and supported runtime. We still need to verify physical RAM separately from extended RAM." };
  }
  if (hasAny(text, ["robot", "motor", "move", "hardware"])) {
    return { text: "The Robotics module is informational only. ATLAS is not connected to motors, sensors or a robot controller. Any future physical system must be developed in simulation first and use independent safety limits, an emergency stop and human supervision." };
  }
  const matches = memorySearch(text, memories);
  if (matches.length) {
    return { text: "I don't have general language-model reasoning yet, but these saved notes may be relevant:\n" + matches.map((item, index) => `${index + 1}. ${item}`).join("\n") };
  }
  return { text: "I don't know how to answer that yet. I'm an early local software core, not a general language model. Try “help”, “roadmap”, “Remember that ...”, or “Find ...”. I won't pretend to know something I can't verify." };
}
