import test from "node:test";
import assert from "node:assert/strict";
import { getBluetoothDiscoveryStatus, discoverBluetoothDevice, scanNativeBluetoothDevices } from "./roboticsDiscovery.js";

test("reports Web Bluetooth unavailable in embedded environments without the API", () => {
  const status = getBluetoothDiscoveryStatus({ isSecureContext: true, navigator: {} });
  assert.equal(status.supported, false);
  assert.match(status.reason, /native ATLAS app/);
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
  assert.deepEqual(options, { acceptAllDevices: true, optionalServices: [0x1800, 0x181a] });
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


import { decodeStandardBleSensors, connectNativeBleSensorDevice } from "./roboticsDiscovery.js";

test("decodes standard BLE temperature and humidity characteristics into real unit-labelled readings", () => {
  const temperature = new DataView(new Uint8Array([0x92, 0x09]).buffer); // 24.50 C
  const humidity = new DataView(new Uint8Array([0x10, 0x27]).buffer); // 100.00 %RH
  const readings = decodeStandardBleSensors({ deviceId: "ble-sensor-1", deviceName: "Env Sensor", temperature, humidity, now: 1000 });
  assert.equal(readings.length, 2);
  assert.equal(readings[0].value, 24.5);
  assert.equal(readings[0].unit, "°C");
  assert.equal(readings[1].value, 100);
  assert.equal(readings[1].unit, "%RH");
  assert.equal(readings[0].timestamp, new Date(1000).toISOString());
});

test("connects to a native BLE peripheral, resolves its GAP name and reads standard environmental sensors", async () => {
  const calls = [];
  const bytes = value => new DataView(new Uint8Array(value).buffer);
  const fakeBle = {
    async initialize() {},
    async isEnabled() { return true; },
    async connect(id) { calls.push(["connect", id]); },
    async getServices() { return [{ uuid: "00001800-0000-1000-8000-00805f9b34fb" }, { uuid: "0000181a-0000-1000-8000-00805f9b34fb" }]; },
    async read(id, service, characteristic) {
      calls.push(["read", service, characteristic]);
      if (characteristic === "2a00") return bytes([69, 110, 118, 32, 78, 111, 100, 101]);
      if (characteristic === "2a6e") return bytes([0x92, 0x09]);
      if (characteristic === "2a6f") return bytes([0x10, 0x27]);
      throw new Error("missing");
    }
  };
  const result = await connectNativeBleSensorDevice({ deviceId: "ble-sensor-1", loadBleClient: async () => ({ BleClient: fakeBle }), now: 1000 });
  assert.equal(result.name, "Env Node");
  assert.equal(result.nameAvailable, true);
  assert.equal(result.connected, true);
  assert.deepEqual(result.sensors.map(sensor => sensor.sensorId), ["temperature", "humidity"]);
  assert.deepEqual(calls[0], ["connect", "ble-sensor-1"]);
});

test("uses a visible BLE identifier instead of the misleading Unknown/Unnamed label", async () => {
  const found = [];
  const fakeBle = {
    async initialize() {},
    async isEnabled() { return true; },
    async requestLEScan(options, callback) { callback({ device: { deviceId: "A1B2C3D4", name: null }, rssi: -60 }); },
    async stopLEScan() {}
  };
  await scanNativeBluetoothDevices({
    environment: { Capacitor: { isNativePlatform: () => true } },
    durationMs: 1000,
    loadBleClient: async () => ({ BleClient: fakeBle }),
    onDevice: device => found.push(device)
  });
  assert.equal(found[0].name, "BLE device · B2C3D4");
});
