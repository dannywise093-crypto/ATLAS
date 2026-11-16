const DEVICE_CLASSES = Object.freeze(["motor", "actuator", "servo", "gripper"]);
const REQUIRED_SAFETY_SIGNALS = Object.freeze(["emergencyStopReleased", "interlocksHealthy", "watchdogHealthy", "limitsVerified", "controllerOnline"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateMotionAdapterProfile(profile) {
  if (!isPlainObject(profile)) return { valid: false, reason: "An approved device profile is required." };
  if (typeof profile.id !== "string" || !/^[a-z0-9][a-z0-9.-]{2,95}$/.test(profile.id)) return { valid: false, reason: "The adapter profile ID is invalid." };
  if (!DEVICE_CLASSES.includes(profile.deviceClass)) return { valid: false, reason: "The device class must be motor, actuator, servo or gripper." };
  if (typeof profile.transport !== "string" || !profile.transport.trim()) return { valid: false, reason: "A supported transport is required." };
  if (profile.safetyClass !== "supervised-control") return { valid: false, reason: "The profile must declare supervised-control safety." };
  if (profile.vendorApproved !== true || profile.independentlySafetyReviewed !== true) return { valid: false, reason: "Vendor approval and independent safety review are required." };
  if (!Array.isArray(profile.approvedCommands) || profile.approvedCommands.length === 0) return { valid: false, reason: "At least one vendor-approved command identifier is required." };
  if (profile.approvedCommands.some(command => typeof command !== "string" || !/^[a-z][a-z0-9._-]{1,63}$/.test(command))) return { valid: false, reason: "Approved commands must be stable identifiers, not free-form instructions." };
  if (new Set(profile.approvedCommands).size !== profile.approvedCommands.length) return { valid: false, reason: "Approved command identifiers must be unique." };
  return { valid: true, reason: "" };
}

export function evaluateHardwareControlReadiness({ profile, deviceId, safetyStatus } = {}) {
  const profileResult = validateMotionAdapterProfile(profile);
  const checks = {
    approvedProfile: profileResult.valid,
    deviceIdentified: typeof deviceId === "string" && deviceId.trim().length > 0,
    emergencyStopReleased: safetyStatus?.emergencyStopReleased === true,
    interlocksHealthy: safetyStatus?.interlocksHealthy === true,
    watchdogHealthy: safetyStatus?.watchdogHealthy === true,
    limitsVerified: safetyStatus?.limitsVerified === true,
    controllerOnline: safetyStatus?.controllerOnline === true
  };
  return Object.freeze({ ready: Object.values(checks).every(Boolean), checks: Object.freeze(checks), reason: profileResult.valid ? "" : profileResult.reason });
}

export function prepareHardwareCommandRequest({
  profile, deviceId, commandId, operatorAuthorized = false, operatorConfirmed = false,
  safetyStatus, now = Date.now(), ttlMs = 5000
} = {}) {
  const readiness = evaluateHardwareControlReadiness({ profile, deviceId, safetyStatus });
  if (!readiness.ready) throw new Error(readiness.reason || "Hardware safety readiness checks have not all passed.");
  if (operatorAuthorized !== true || operatorConfirmed !== true) throw new Error("An authorized operator and explicit command confirmation are required.");
  if (!profile.approvedCommands.includes(commandId)) throw new Error("The requested command is not in this device profile's approved command list.");
  if (!Number.isFinite(now) || !Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 10000) throw new TypeError("A valid timestamp and a command lifetime between 1 and 10 seconds are required.");
  return Object.freeze({
    requestId: `atlas-${now.toString(36)}`,
    deviceId: deviceId.trim(),
    adapterProfileId: profile.id,
    deviceClass: profile.deviceClass,
    transport: profile.transport,
    commandId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    requiresIndependentHardwareGate: true,
    dispatchState: "prepared-not-dispatched"
  });
}

export function isHardwareCommandRequestFresh(request, now = Date.now()) {
  if (!isPlainObject(request) || request.dispatchState !== "prepared-not-dispatched") return false;
  const expiresAt = Date.parse(request.expiresAt);
  return Number.isFinite(expiresAt) && Number.isFinite(now) && now <= expiresAt;
}

export const HARDWARE_COMMAND_DEVICE_CLASSES = DEVICE_CLASSES;
export const HARDWARE_COMMAND_REQUIRED_SAFETY_SIGNALS = REQUIRED_SAFETY_SIGNALS;
