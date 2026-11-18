import test from "node:test";
import assert from "node:assert/strict";
import { ROBOTICS_TRANSPORTS, getRoboticsTransportCatalog, validateReadOnlyAdapter } from "./roboticsTransports.js";

test("catalog covers wireless, wired, vehicle, industrial and robotics middleware transports", () => {
  const ids = ROBOTICS_TRANSPORTS.map(item => item.id);
  for (const id of ["bluetooth-le", "bluetooth-classic", "wifi-lan", "wifi-direct", "ethernet", "usb-otg", "usb-serial", "can-bus", "ros2-dds", "micro-ros", "mqtt", "modbus", "opcua", "http-ws", "vendor-sdk", "camera-sensors"]) {
    assert.ok(ids.includes(id), "missing transport: " + id);
  }
});

test("only marks native Android BLE as currently available", () => {
  const catalog = getRoboticsTransportCatalog({ nativeAndroid: true });
  assert.equal(catalog.find(item => item.id === "bluetooth-le").state, "available");
  assert.equal(catalog.filter(item => item.state === "available").length, 1);
  assert.equal(getRoboticsTransportCatalog().find(item => item.id === "bluetooth-le").state, "implemented");
});

test("accepts a least-privilege read-only adapter descriptor", () => {
  assert.deepEqual(validateReadOnlyAdapter({
    id: "atlas.ble.adapter",
    transport: "bluetooth-le",
    safetyClass: "read-only",
    capabilities: ["device.discovery", "telemetry.read"],
    actuationEnabled: false
  }), { valid: true, reason: "" });
});

test("rejects unknown transports and elevated capabilities", () => {
  const base = { id: "atlas.demo.adapter", transport: "bluetooth-le", safetyClass: "read-only", capabilities: ["device.discovery"] };
  assert.equal(validateReadOnlyAdapter({ ...base, transport: "unknown" }).valid, false);
  assert.equal(validateReadOnlyAdapter({ ...base, capabilities: ["device.discovery", "motor.command"] }).valid, false);
  assert.equal(validateReadOnlyAdapter({ ...base, safetyClass: "actuation" }).valid, false);
  assert.equal(validateReadOnlyAdapter({ ...base, actuationEnabled: true }).valid, false);
});
