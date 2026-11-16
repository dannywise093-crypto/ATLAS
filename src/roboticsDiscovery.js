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
  const device = await environment.navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [] });
  if (!device) throw new Error('No Bluetooth device was selected.');
  let connected = false;
  if (device.gatt) { try { await device.gatt.connect(); connected = Boolean(device.gatt.connected); } catch { connected = false; } }
  return Object.freeze({ id: String(device.id || ''), name: String(device.name || 'Unnamed Bluetooth device'), transport: 'Bluetooth LE', connection: connected ? 'connected' : 'selected', connected, device });
}

export async function scanNativeBluetoothDevices({ environment = globalThis, onDevice = () => {}, durationMs = 12000, loadBleClient = () => import('@capacitor-community/bluetooth-le') } = {}) {
  if (!environment.Capacitor?.isNativePlatform?.()) throw new Error('Native Bluetooth scanning is available inside the ATLAS Android app.');
  const { BleClient } = await loadBleClient();
  await BleClient.initialize({ androidNeverForLocation: true });
  if (!(await BleClient.isEnabled())) throw new Error('Bluetooth is turned off. Enable Bluetooth in Android settings and try again.');
  let found = 0;
  await BleClient.requestLEScan({ allowDuplicates: false }, result => {
    const device = result?.device || {};
    const item = Object.freeze({ id: String(device.deviceId || ''), name: String(result.localName || device.name || 'Unnamed BLE device'), transport: 'Bluetooth LE', rssi: Number.isFinite(result.rssi) ? result.rssi : null, services: Array.isArray(result.uuids) ? result.uuids : [], connection: 'discovered', connected: false });
    if (!item.id) return;
    found += 1;
    onDevice(item);
  });
  try { await new Promise(resolve => setTimeout(resolve, Math.max(1000, Math.min(durationMs, 30000)))); }
  finally { await BleClient.stopLEScan(); }
  return { found };
}