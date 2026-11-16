import test from "node:test";
import assert from "node:assert/strict";
import { getBluetoothDiscoveryStatus, discoverBluetoothDevice } from "./roboticsDiscovery.js";

test("reports Web Bluetooth unavailable in embedded environments without the API", () => {
  const status = getBluetoothDiscoveryStatus({ isSecureContext: true, navigator: {} });
  assert.equal(status.supported, false);
  assert.match(status.reason, /Native Android integration is not installed/);
});

test("requires a secure context for Bluetooth discovery", () => {
  const status = getBluetoothDiscoveryStatus({
    isSecureContext: false,
    navigator: { bluetooth: { requestDevice() {} } }
  });
  assert.equal(status.supported, false);
  assert.match(status.reason, /secure HTTPS/);
});

test("requests an explicitly selected BLE device and reports connection health", async () => {
  let options;
  const device = { id: "ble-123", name: "Test sensor", gatt: {
    connected: false,
    async connect() { this.connected = true; return this; }
  }};
  const environment = { isSecureContext: true, navigator: { bluetooth: {
    async requestDevice(value) { options = value; return device; }
  }}};
  const result = await discoverBluetoothDevice(environment);
  assert.deepEqual(options, { acceptAllDevices: true, optionalServices: [] });
  assert.equal(result.id, "ble-123");
  assert.equal(result.name, "Test sensor");
  assert.equal(result.connected, true);
});

test("does not claim a connection when the GATT connection fails", async () => {
  const environment = { isSecureContext: true, navigator: { bluetooth: {
    async requestDevice() { return { id: "ble-456", gatt: { async connect() { throw new Error("unavailable"); } } }; }
  }}};
  const result = await discoverBluetoothDevice(environment);
  assert.equal(result.connection, "selected");
  assert.equal(result.connected, false);
});

test("surfaces browser cancellation or permission errors", async () => {
  const environment = { isSecureContext: true, navigator: { bluetooth: {
    async requestDevice() { throw new Error("User cancelled"); }
  }}};
  await assert.rejects(discoverBluetoothDevice(environment), /User cancelled/);
});
