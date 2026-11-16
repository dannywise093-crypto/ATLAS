const ALLOWED_CAPABILITIES = new Set(["device.discovery", "telemetry.read"]);
const ALLOWED_PERMISSIONS = new Set(["device.identity", "telemetry.read"]);
const VALID_TRANSPORTS = new Set(["bluetooth", "usb", "serial", "wifi", "ethernet", "ros2", "can", "vendor-sdk", "simulation"]);

export function validateRoboticsManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return { valid: false, errors: ["Manifest must be an object."] };
  if (manifest.schemaVersion !== "1.0") errors.push("Unsupported schemaVersion.");
  if (!/^[a-z0-9][a-z0-9.-]{2,95}$/.test(manifest.pluginId || "")) errors.push("pluginId must be a stable lowercase identifier.");
  if (typeof manifest.displayName !== "string" || !manifest.displayName.trim()) errors.push("displayName is required.");
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+/.test(manifest.version)) errors.push("version must be semantic version text.");
  if (!VALID_TRANSPORTS.has(manifest.transport)) errors.push("Unsupported transport.");
  if (!Array.isArray(manifest.capabilities) || !manifest.capabilities.length) errors.push("At least one capability is required.");
  else if (manifest.capabilities.some(value => !ALLOWED_CAPABILITIES.has(value))) errors.push("Only discovery and read-only telemetry capabilities are permitted.");
  if (!Array.isArray(manifest.permissions) || manifest.permissions.some(value => !ALLOWED_PERMISSIONS.has(value))) errors.push("Unknown or elevated permissions are not permitted.");
  if (manifest.safetyClass !== "read-only") errors.push("Only read-only plugins are accepted in this phase.");
  if (manifest.actuationEnabled === true) errors.push("Actuation is disabled.");
  return { valid: errors.length === 0, errors };
}

export function normalizeRoboticsTelemetry(input, { now = Date.now(), maxAgeMs = 60_000 } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Telemetry must be an object.");
  const { deviceId, sensorId, value, unit, timestamp, quality = "good", sourcePlugin } = input;
  if (typeof deviceId !== "string" || !deviceId.trim()) throw new TypeError("deviceId is required.");
  if (typeof sensorId !== "string" || !sensorId.trim()) throw new TypeError("sensorId is required.");
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("value must be a finite number.");
  if (typeof unit !== "string" || !unit.trim()) throw new TypeError("unit is required.");
  if (typeof sourcePlugin !== "string" || !sourcePlugin.trim()) throw new TypeError("sourcePlugin is required.");
  const parsedTimestamp = typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(parsedTimestamp) || parsedTimestamp > now + 5_000) throw new TypeError("timestamp must be valid and not in the future.");
  if (!["good", "degraded", "invalid"].includes(quality)) throw new TypeError("quality must be good, degraded, or invalid.");
  return Object.freeze({
    deviceId: deviceId.trim(),
    sensorId: sensorId.trim(),
    value,
    unit: unit.trim(),
    timestamp: new Date(parsedTimestamp).toISOString(),
    quality: parsedTimestamp < now - maxAgeMs && quality === "good" ? "degraded" : quality,
    stale: now - parsedTimestamp > maxAgeMs,
    sourcePlugin: sourcePlugin.trim()
  });
}

export const ROBOTICS_BRIDGE_CAPABILITIES = Object.freeze({
  transports: ["Bluetooth LE", "USB OTG", "Wi-Fi", "Ethernet", "ROS 2 / DDS", "CAN adapters", "Manufacturer SDKs"],
  supportedPeerPlatforms: ["Android", "Linux", "Windows", "Embedded Linux", "Microcontrollers", "Industrial controllers"],
  phase: "simulation-and-read-only-telemetry"
});
