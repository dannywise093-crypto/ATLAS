import test from "node:test";
import assert from "node:assert/strict";
import { validateRoboticsManifest, normalizeRoboticsTelemetry } from "./roboticsBridge.js";

const validManifest = {
  schemaVersion: "1.0", pluginId: "example.serial.adapter", displayName: "Example Serial",
  version: "1.0.0", transport: "serial", capabilities: ["device.discovery", "telemetry.read"],
  permissions: ["device.identity", "telemetry.read"], safetyClass: "read-only", actuationEnabled: false
};

test("accepts a read-only adapter manifest", () => assert.equal(validateRoboticsManifest(validManifest).valid, true));
test("rejects unsupported capabilities and actuation", () => {
  const result = validateRoboticsManifest({ ...validManifest, capabilities: ["motor.command"], actuationEnabled: true });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => /read-only|Actuation/.test(error)));
});
test("rejects unknown permissions", () => assert.equal(validateRoboticsManifest({ ...validManifest, permissions: ["shell.execute"] }).valid, false));
test("rejects an unsupported schema version", () => assert.equal(validateRoboticsManifest({ ...validManifest, schemaVersion: "2.0" }).valid, false));
test("normalizes valid telemetry and marks stale readings", () => {
  const result = normalizeRoboticsTelemetry({ deviceId:"robot-1",sensorId:"imu-1",value:1.25,unit:"m/s2",timestamp:1_000,sourcePlugin:"example.imu" }, { now:100_000,maxAgeMs:10_000 });
  assert.equal(result.stale, true);
  assert.equal(result.quality, "degraded");
  assert.equal(result.value, 1.25);
});
test("rejects non-finite sensor values", () => assert.throws(() => normalizeRoboticsTelemetry({ deviceId:"r",sensorId:"s",value:Infinity,unit:"C",timestamp:Date.now(),sourcePlugin:"p" }), /finite/));
test("rejects future timestamps", () => assert.throws(() => normalizeRoboticsTelemetry({ deviceId:"r",sensorId:"s",value:1,unit:"C",timestamp:Date.now()+60_000,sourcePlugin:"p" }), /future/));
test("rejects missing units", () => assert.throws(() => normalizeRoboticsTelemetry({ deviceId:"r",sensorId:"s",value:1,timestamp:Date.now(),sourcePlugin:"p" }), /unit/));
