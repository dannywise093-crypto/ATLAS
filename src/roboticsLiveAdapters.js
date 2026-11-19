const MAX_LINE_LENGTH = 16_384;

function safeEndpoint(value, protocols = ["https:", "http:", "wss:", "ws:"]) {
  const url = new URL(value);
  if (!protocols.includes(url.protocol)) throw new TypeError("Only HTTP(S) or WebSocket endpoints are accepted.");
  if (url.username || url.password) throw new TypeError("Do not embed credentials in endpoint URLs.");
  return url;
}

function parseTelemetryMessage(raw, source, now = Date.now()) {
  const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.telemetry) ? payload.telemetry : [payload];
  return rows.filter(row => row && typeof row === "object" && !Array.isArray(row)).map((row, index) => {
    const value = Number(row.value);
    if (!Number.isFinite(value)) return null;
    const timestamp = row.timestamp ?? now;
    return Object.freeze({
      deviceId: String(row.deviceId || row.device_id || source),
      sensorId: String(row.sensorId || row.sensor_id || row.name || `sensor-${index + 1}`),
      value,
      unit: String(row.unit || ""),
      timestamp: new Date(typeof timestamp === "number" ? timestamp : Date.parse(timestamp)).toISOString(),
      quality: ["good", "degraded", "invalid"].includes(row.quality) ? row.quality : "good",
      source
    });
  }).filter(Boolean);
}

export function getRoboticsBrowserCapabilities(environment = globalThis) {
  const nav = environment.navigator || {};
  return Object.freeze({
    httpTelemetry: typeof environment.fetch === "function",
    websocketTelemetry: typeof environment.WebSocket === "function",
    usbSerial: Boolean(nav.serial?.requestPort),
    usbHost: Boolean(nav.usb?.requestDevice),
    camera: Boolean(nav.mediaDevices?.getUserMedia),
    ble: Boolean(nav.bluetooth?.requestDevice)
  });
}

/** Read-only JSON telemetry over an authenticated device/gateway HTTP endpoint. */
export async function readHttpTelemetry({ url, token, fetchImpl = globalThis.fetch, signal, source = "http-ws" } = {}) {
  const endpoint = safeEndpoint(url, ["https:", "http:"]);
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable in this runtime.");
  const response = await fetchImpl(endpoint.toString(), {
    method: "GET",
    headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal
  });
  if (!response.ok) throw new Error(`Telemetry endpoint returned HTTP ${response.status}.`);
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType && !contentType.toLowerCase().includes("json")) throw new Error("Telemetry endpoint must return JSON.");
  return parseTelemetryMessage(await response.json(), source);
}

/** Open a read-only WebSocket telemetry feed. The adapter never sends messages. */
export function openWebSocketTelemetry({ url, token, WebSocketImpl = globalThis.WebSocket, onTelemetry = () => {}, onStatus = () => {} } = {}) {
  const endpoint = safeEndpoint(url, ["wss:", "ws:"]);
  if (endpoint.protocol !== "wss:" && !["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname)) {
    throw new TypeError("Use WSS for remote telemetry feeds.");
  }
  if (typeof WebSocketImpl !== "function") throw new Error("WebSocket is unavailable in this runtime.");
  if (token) endpoint.searchParams.set("access_token", token);
  const socket = new WebSocketImpl(endpoint.toString());
  socket.addEventListener("open", () => onStatus("connected"));
  socket.addEventListener("message", event => {
    try { onTelemetry(parseTelemetryMessage(event.data, "http-ws")); }
    catch (error) { onStatus(`invalid telemetry: ${error.message}`); }
  });
  socket.addEventListener("error", () => onStatus("connection error"));
  socket.addEventListener("close", () => onStatus("disconnected"));
  return Object.freeze({ socket, close: () => socket.close() });
}

/** Select a USB serial device with the browser permission picker and read JSON-lines only. */
export async function openUsbSerialTelemetry({ environment = globalThis, baudRate = 115200, onTelemetry = () => {}, onStatus = () => {} } = {}) {
  const serial = environment.navigator?.serial;
  if (!serial?.requestPort) throw new Error("Web Serial is unavailable. Use a supported Chromium browser or native serial gateway.");
  const port = await serial.requestPort();
  await port.open({ baudRate });
  if (!port.readable) { await port.close(); throw new Error("The selected serial port has no readable stream."); }
  const reader = port.readable.pipeThrough(new environment.TextDecoderStream()).getReader();
  let buffer = "";
  let stopped = false;
  const done = (async () => {
    try {
      while (!stopped) {
        const { value, done: ended } = await reader.read();
        if (ended) break;
        buffer += value;
        if (buffer.length > MAX_LINE_LENGTH) throw new Error("Serial telemetry line exceeded the size limit.");
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) onTelemetry(parseTelemetryMessage(line, "usb-serial"));
        }
      }
    } catch (error) {
      if (!stopped) onStatus(`serial read error: ${error.message}`);
    } finally {
      try { reader.releaseLock(); } catch {}
      try { await port.close(); } catch {}
      onStatus("disconnected");
    }
  })();
  onStatus("connected");
  return Object.freeze({
    port,
    done,
    close: async () => {
      stopped = true;
      try { await reader.cancel(); } catch {}
      await done;
    }
  });
}

/** User-mediated USB selection. Exposes descriptors only; no vendor commands are sent. */
export async function selectUsbDevice({ environment = globalThis, filters = [] } = {}) {
  const usb = environment.navigator?.usb;
  if (!usb?.requestDevice) throw new Error("WebUSB is unavailable in this browser.");
  const device = await usb.requestDevice({ filters });
  return Object.freeze({
    vendorId: device.vendorId,
    productId: device.productId,
    productName: device.productName || "USB device",
    manufacturerName: device.manufacturerName || "Unknown manufacturer",
    serialNumberAvailable: Boolean(device.serialNumber)
  });
}

/** Start a local camera preview. Video only; no audio capture or network upload. */
export async function startCameraPreview({ environment = globalThis, video = true } = {}) {
  const mediaDevices = environment.navigator?.mediaDevices;
  if (!mediaDevices?.getUserMedia) throw new Error("Camera capture is unavailable in this browser.");
  const stream = await mediaDevices.getUserMedia({ audio: false, video });
  return Object.freeze({
    stream,
    stop: () => stream.getTracks().forEach(track => track.stop())
  });
}
