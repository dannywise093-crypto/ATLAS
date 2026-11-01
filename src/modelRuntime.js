// ATLAS Neural Runtime boundary (v0.1)
//
// This module defines the app-side contract for a future on-device model.
// It intentionally does not download models, call external AI APIs, or claim
// that neural inference is available. A native Android runtime must be added
// and benchmarked before this status can change.

const unavailableRuntime = {
  id: "none",
  label: "No neural model installed",
  available: false,
  reason:
    "ATLAS currently uses its transparent rule-based core. Android model runtime support has not been integrated or benchmarked on this device.",
};

let activeRuntime = unavailableRuntime;

/**
 * Return a safe, displayable summary of the configured model runtime.
 * Do not expose file paths, credentials, or private device data here.
 */
export function getNeuralRuntimeStatus() {
  return { ...activeRuntime };
}

/**
 * Register a future local runtime adapter.
 * Adapter contract:
 *   { id, label, available: true, generate: async ({ prompt, signal }) => string }
 * The adapter must run locally and must not silently send prompts to a server.
 */
export function registerLocalRuntime(adapter) {
  if (!adapter || typeof adapter.id !== "string" ||
      typeof adapter.label !== "string" ||
      typeof adapter.generate !== "function") {
    throw new TypeError("A local runtime needs id, label, and generate().");
  }
  activeRuntime = {
    id: adapter.id,
    label: adapter.label,
    available: true,
    generate: adapter.generate,
  };
}

/**
 * Ask the configured local model. Returns null while no runtime is installed,
 * allowing the UI to fall back honestly to ATLAS Core.
 */
export async function generateWithLocalModel(prompt, signal) {
  if (!activeRuntime.available || typeof activeRuntime.generate !== "function") {
    return null;
  }
  const result = await activeRuntime.generate({ prompt: String(prompt || ""), signal });
  return typeof result === "string" ? result : String(result ?? "");
}
