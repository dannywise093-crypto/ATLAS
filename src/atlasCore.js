// ATLAS Local Core v0.1
// A small, transparent on-device intent and memory engine.
// This is not a trained language model; it provides the first offline foundation.

const normalize = (value = "") =>
  value.toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();

const includesAny = (text, terms) => terms.some((term) => text.includes(term));

export function runAtlasCore(message, memories = []) {
  const raw = String(message || "").trim();
  const text = normalize(raw);

  if (!text) {
    return { text: "I didn't receive a message. What would you like to work on?" };
  }

  // Local memory command: "remember that ..." or "save this: ..."
  const memoryMatch = raw.match(/^(?:remember that|remember|save this|store this)\s*[:,-]?\s*(.+)$/i);
  if (memoryMatch?.[1]) {
    const note = memoryMatch[1].trim();
    return {
      action: "save_memory",
      memory: note,
      text: `I saved this to ATLAS memory on this device: “${note}”`,
    };
  }

  if (includesAny(text, ["hello", "hi atlas", "hey atlas", "good morning", "good afternoon"])) {
    return {
      text: "Hello. I'm ATLAS Core, running locally on this device. I can respond to a small set of built-in intents and use the project notes saved on this phone. I'm still an early foundation, not a full language model.",
    };
  }

  if (includesAny(text, ["who are you", "what are you", "introduce yourself"])) {
    return {
      text: "I'm ATLAS Core v0.1: the first local intelligence layer for your ATLAS project. My current abilities are rule-based conversation, simple intent recognition and access to local project memory. No external AI service is being called.",
    };
  }

  if (includesAny(text, ["what do you remember", "show memory", "my memories", "what have you learned"])) {
    return {
      text: memories.length
        ? "Here are the project notes currently stored on this device:\n" +
          memories.map((item, index) => `${index + 1}. ${item}`).join("\n")
        : "There are no saved notes yet. Teach me something with: “Remember that ...”",
    };
  }

  if (includesAny(text, ["help", "what can you do", "capabilities", "commands"])) {
    return {
      text: [
        "ATLAS Core v0.1 can:",
        "• Recognise a few built-in conversation intents.",
        "• Save a note locally when you say “Remember that ...”.",
        "• Recall notes when you ask “What do you remember?”.",
        "• Explain the ATLAS project and its development stages.",
        "",
        "This version does not yet generate open-ended answers, learn model weights, analyse images or control robots.",
      ].join("\n"),
    };
  }

  if (includesAny(text, ["offline", "internet", "without internet", "local ai"])) {
    return {
      text: "This core runs inside the installed app and its basic rules do not need an AI server. A capable conversational model can later run locally too, but that needs a model file, compatible runtime and enough device memory. The current core is not yet a full offline language model.",
    };
  }

  if (includesAny(text, ["robot", "motor", "move", "hardware"])) {
    return {
      text: "The Robotics module is currently a status interface only. No robot is connected and I cannot send movement commands. Before any hardware integration, ATLAS will need simulation, an independent safety controller, emergency stop, motion limits and human supervision.",
    };
  }

  if (includesAny(text, ["build", "develop", "roadmap", "next step", "start"])) {
    return {
      text: "Our next development steps are: (1) strengthen this local core and its tests, (2) build reliable local memory, (3) add a small on-device language model if the hardware supports it, and (4) add vision and voice. We should verify each feature before marking it as working.",
    };
  }

  const savedContext = memories.length
    ? ` I currently have ${memories.length} project note(s) saved locally; ask “What do you remember?” to review them.`
    : " You can teach me a project note by saying “Remember that ...”.";

  return {
    text: "I don't understand that request yet. ATLAS Core is an early offline engine with a limited set of built-in intents, not a general language model. Try “help”, “who are you?”, or “Remember that ATLAS is my personal AI project”." + savedContext,
  };
}
