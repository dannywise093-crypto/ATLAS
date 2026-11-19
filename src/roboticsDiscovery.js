export function getBluetoothDiscoveryStatus(environment = globalThis) {
  const secure = environment.isSecureContext === true;
  const bluetooth = environment.navigator?.bluetooth;
  const native = Boolean(environment.Capacitor?.isNativePlatform?.());
  if (native) return Object.freeze({ supported: true, secure, native: true, transport: 'bluetooth-le', reason: 'Native Android Bluetooth LE discovery is available in the ATLAS app. Scanning starts only after you press the discovery button.' });
  return Object.freeze({ supported: secure && typeof bluetooth?.requestDevice === 'function', secure, native: false, transport: 'bluetooth-le', reason: !secure ? 'Bluetooth discovery requires a secure HTTPS context.' : typeof bluetooth?.requestDevice !== 'function' ? 'This browser does not expose Web Bluetooth. Open ATLAS in Android Chrome or use the native ATLAS app.' : 'Bluetooth discovery is available. Device selection requires an explicit user action.' });
}

export async function discoverBluetoothDevice(environment = globalThis) {
  const status = getBluetoothDiscoveryStatus(environment);
  if (!status.supported || status.native) throw new Error(status.reason);
  const device = await environment.navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [0x1800, 0x181a] });
  if (!device) throw new Error('No Bluetooth device was selected.');
  let connected = false;
  if (device.gatt) { try { await device.gatt.connect(); connected = Boolean(device.gatt.connected); } catch { connected = false; } }
  return Object.freeze({ id: String(device.id || ''), name: String(device.name || ('BLE device · ' + String(device.id || '').replace(/[^a-z0-9]/gi, '').slice(-6))), transport: 'Bluetooth LE', connection: connected ? 'connected' : 'selected', connected, device });
}

export async function scanNativeBluetoothDevices({ environment = globalThis, onDevice = () => {}, durationMs = 12000, loadBleClient = () => import('@capacitor-community/bluetooth-le') } = {}) {
  if (!environment.Capacitor?.isNativePlatform?.()) throw new Error('Native Bluetooth scanning is available inside the ATLAS Android app.');
  const { BleClient } = await loadBleClient();
  await BleClient.initialize({ androidNeverForLocation: true });
  if (!(await BleClient.isEnabled())) throw new Error('Bluetooth is turned off. Enable Bluetooth in Android settings and try again.');
  let found = 0;
  await BleClient.requestLEScan({ allowDuplicates: false }, result => {
    const device = result?.device || {};
    const item = Object.freeze({ id: String(device.deviceId || ''), name: String(result.localName || device.name || ('BLE device · ' + String(device.deviceId || '').replace(/[^a-z0-9]/gi, '').slice(-6))), transport: 'Bluetooth LE', rssi: Number.isFinite(result.rssi) ? result.rssi : null, services: Array.isArray(result.uuids) ? result.uuids : [], connection: 'discovered', connected: false });
    if (!item.id) return;
    found += 1;
    onDevice(item);
  });
  try { await new Promise(resolve => setTimeout(resolve, Math.max(1000, Math.min(durationMs, 30000)))); }
  finally { await BleClient.stopLEScan(); }
  return { found };
}
export function decodeStandardBleSensors({ deviceId, deviceName, temperature, humidity, now = Date.now() }) {
  const readings = [];
  if (temperature instanceof DataView && temperature.byteLength >= 2) {
    readings.push(Object.freeze({ deviceId, deviceName, sensorId: "temperature", value: temperature.getInt16(0, true) / 100, unit: "°C", timestamp: new Date(now).toISOString(), quality: "good", sourcePlugin: "atlas.ble.environmental-sensing" }));
  }
  if (humidity instanceof DataView && humidity.byteLength >= 2) {
    readings.push(Object.freeze({ deviceId, deviceName, sensorId: "humidity", value: humidity.getUint16(0, true) / 100, unit: "%RH", timestamp: new Date(now).toISOString(), quality: "good", sourcePlugin: "atlas.ble.environmental-sensing" }));
  }
  return readings;
}

function bleFallbackName(deviceId) {
  const suffix = String(deviceId || "").replace(/[^a-z0-9]/gi, "").slice(-6);
  return suffix ? "BLE device · " + suffix : "BLE device";
}

export async function connectNativeBleSensorDevice({ deviceId, loadBleClient = () => import("@capacitor-community/bluetooth-le"), now = Date.now() } = {}) {
  if (!deviceId) throw new Error("A discovered Bluetooth device ID is required.");
  const { BleClient } = await loadBleClient();
  await BleClient.initialize({ androidNeverForLocation: true });
  if (!(await BleClient.isEnabled())) throw new Error("Bluetooth is turned off. Enable Bluetooth in Android settings and try again.");
  await BleClient.connect(deviceId);
  const services = await BleClient.getServices(deviceId);
  const has = (uuid) => services.some(service => String(service.uuid || "").toLowerCase().endsWith(uuid));
  let deviceName = bleFallbackName(deviceId);
  let nameAvailable = false;
  if (has("1800")) {
    try {
      const value = await BleClient.read(deviceId, "1800", "2a00");
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const decoded = new TextDecoder().decode(bytes).replace(/\0/g, "").trim();
      if (decoded) { deviceName = decoded; nameAvailable = true; }
    } catch {}
  }
  let temperature;
  let humidity;
  if (has("181a")) {
    try { temperature = await BleClient.read(deviceId, "181a", "2a6e"); } catch {}
    try { humidity = await BleClient.read(deviceId, "181a", "2a6f"); } catch {}
  }
  const sensors = decodeStandardBleSensors({ deviceId, deviceName, temperature, humidity, now });
  return Object.freeze({
    id: deviceId,
    name: deviceName,
    nameAvailable,
    transport: "Bluetooth LE",
    connection: "connected",
    connected: true,
    sensors,
    sensorStatus: sensors.length ? "Read-only standard BLE sensor snapshot received." : "Connected, but this device does not expose the standard BLE temperature or humidity characteristics."
  });
}

export async function disconnectNativeBleDevice(deviceId, loadBleClient = () => import("@capacitor-community/bluetooth-le")) {
  if (!deviceId) return;
  const { BleClient } = await loadBleClient();
  await BleClient.disconnect(deviceId);
}

export async function readWebBleEnvironmentalSensors(device, now = Date.now()) {
  if (!device?.gatt) throw new Error("The selected BLE device does not support GATT.");
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  let deviceName = device.name || bleFallbackName(device.id);
  let nameAvailable = Boolean(device.name);
  try {
    const gap = await server.getPrimaryService(0x1800);
    const nameCharacteristic = await gap.getCharacteristic(0x2a00);
    const value = await nameCharacteristic.readValue();
    const decoded = new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).replace(/\0/g, "").trim();
    if (decoded) { deviceName = decoded; nameAvailable = true; }
  } catch {}
  let temperature;
  let humidity;
  try {
    const service = await server.getPrimaryService(0x181a);
    try { temperature = await (await service.getCharacteristic(0x2a6e)).readValue(); } catch {}
    try { humidity = await (await service.getCharacteristic(0x2a6f)).readValue(); } catch {}
  } catch {}
  const sensors = decodeStandardBleSensors({ deviceId: device.id, deviceName, temperature, humidity, now });
  return Object.freeze({
    id: String(device.id || ""),
    name: deviceName,
    nameAvailable,
    transport: "Bluetooth LE",
    connection: "connected",
    connected: Boolean(device.gatt.connected),
    sensors,
    sensorStatus: sensors.length ? "Live standard BLE sensor readings received." : "Connected, but this device does not expose the standard BLE temperature or humidity characteristics."
  });
}
