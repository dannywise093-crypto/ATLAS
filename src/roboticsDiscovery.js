export function getBluetoothDiscoveryStatus(environment = globalThis) {
  const secure = environment.isSecureContext === true;
  const bluetooth = environment.navigator?.bluetooth;
  return Object.freeze({
    supported: secure && typeof bluetooth?.requestDevice === "function",
    secure,
    transport: "bluetooth-le",
    reason: !secure ? "Bluetooth discovery requires a secure HTTPS context." :
      typeof bluetooth?.requestDevice !== "function" ? "This browser or embedded WebView does not expose Web Bluetooth. Native Android integration is not installed in this build." :
      "Bluetooth discovery is available. Device selection requires an explicit user action."
  });
}

export async function discoverBluetoothDevice(environment = globalThis) {
  const status = getBluetoothDiscoveryStatus(environment);
  if (!status.supported) throw new Error(status.reason);
  const device = await environment.navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: []
  });
  if (!device) throw new Error("No Bluetooth device was selected.");
  let connected = false;
  if (device.gatt) {
    try {
      await device.gatt.connect();
      connected = Boolean(device.gatt.connected);
    } catch {
      connected = false;
    }
  }
  return Object.freeze({
    id: String(device.id || ""),
    name: String(device.name || "Unnamed Bluetooth device"),
    transport: "Bluetooth LE",
    connection: connected ? "connected" : "selected",
    connected,
    device
  });
}
