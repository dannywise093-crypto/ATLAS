import test from "node:test";
import assert from "node:assert/strict";
import { getBluetoothDiscoveryStatus, discoverBluetoothDevice, scanNativeBluetoothDevices } from "./roboticsDiscovery.js";

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

test("native Android scan initializes BLE and returns discovered devices", async () => {
  const calls = [];
  let onResult;
  const fakeBle = {
    async initialize(options) { calls.push(["initialize", options]); },
    async isEnabled() { return true; },
    async requestLEScan(options, callback) { calls.push(["scan", options]); onResult = callback; },
    async stopLEScan() { calls.push(["stop"]); }
  };
  const found = [];
  const resultPromise = scanNativeBluetoothDevices({
    environment: { Capacitor: { isNativePlatform: () => true } },
    durationMs: 1000,
    loadBleClient: async () => ({ BleClient: fakeBle }),
    onDevice: device => found.push(device)
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  onResult({ device: { deviceId: "ble-robot-1", name: "Sensor node" }, localName: "Sensor node", rssi: -54, uuids: [] });
  const result = await resultPromise;
  assert.equal(result.found, 1);
  assert.equal(found[0].id, "ble-robot-1");
  assert.equal(found[0].connection, "discovered");
  assert.deepEqual(calls[0], ["initialize", { androidNeverForLocation: true }]);
  assert.deepEqual(calls[1], ["scan", { allowDuplicates: false }]);
  assert.deepEqual(calls[2], ["stop"]);
});

test("native scanner refuses to run outside the native app", async () => {
  await assert.rejects(
    scanNativeBluetoothDevices({ environment: { isSecureContext: true, navigator: {} } }),
    /inside the ATLAS Android app/
  );
});

test("native scanner reports Bluetooth disabled and does not start scanning", async () => {
  let scanStarted = false;
  const fakeBle = {
    async initialize() {},
    async isEnabled() { return false; },
    async requestLEScan() { scanStarted = true; },
    async stopLEScan() {}
  };
  await assert.rejects(
    scanNativeBluetoothDevices({
      environment: { Capacitor: { isNativePlatform: () => true } },
      loadBleClient: async () => ({ BleClient: fakeBle })
    }),
    /Bluetooth is turned off/
  );
  assert.equal(scanStarted, false);
});
