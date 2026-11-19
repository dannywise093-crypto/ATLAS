import test from "node:test";
import assert from "node:assert/strict";
import { getRoboticsBrowserCapabilities, readHttpTelemetry, openWebSocketTelemetry, selectUsbDevice, startCameraPreview } from "./roboticsLiveAdapters.js";

test("reports browser API availability without claiming hardware is connected", () => {
  const caps = getRoboticsBrowserCapabilities({ fetch() {}, WebSocket() {}, navigator: { serial: { requestPort() {} }, usb: { requestDevice() {} }, mediaDevices: { getUserMedia() {} } } });
  assert.equal(caps.httpTelemetry, true);
  assert.equal(caps.websocketTelemetry, true);
  assert.equal(caps.usbSerial, true);
  assert.equal(caps.usbHost, true);
  assert.equal(caps.camera, true);
});

test("reads and normalizes JSON telemetry with GET only", async () => {
  let request;
  const readings = await readHttpTelemetry({
    url: "https://gateway.example.test/telemetry",
    token: "test-token",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ deviceId: "sensor-hub-1", sensorId: "temperature", value: 24.5, unit: "C" }) };
    }
  });
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.headers.Authorization, "Bearer test-token");
  assert.equal(readings[0].value, 24.5);
  assert.equal(readings[0].source, "http-ws");
});

test("rejects credential-bearing URLs and non-JSON endpoint responses", async () => {
  await assert.rejects(() => readHttpTelemetry({ url: "https://user:pass@example.test/data", fetchImpl: async () => {} }), /Do not embed credentials/);
  await assert.rejects(() => readHttpTelemetry({ url: "https://example.test/data", fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => "text/html" } }) }), /must return JSON/);
});

test("WebSocket telemetry is receive-only and requires WSS remotely", () => {
  class FakeSocket {
    constructor(url) { this.url = url; this.listeners = {}; this.sent = []; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    close() { this.closed = true; }
    send(value) { this.sent.push(value); }
  }
  assert.throws(() => openWebSocketTelemetry({ url: "ws://remote.example.test/feed", WebSocketImpl: FakeSocket }), /Use WSS/);
  const connection = openWebSocketTelemetry({ url: "wss://gateway.example.test/feed", token: "abc", WebSocketImpl: FakeSocket });
  assert.match(connection.socket.url, /access_token=abc/);
  assert.deepEqual(connection.socket.sent, []);
  connection.close();
});

test("USB and camera adapters require user-selected browser APIs", async () => {
  await assert.rejects(() => selectUsbDevice({ environment: { navigator: {} } }), /WebUSB is unavailable/);
  await assert.rejects(() => startCameraPreview({ environment: { navigator: {} } }), /Camera capture is unavailable/);
});
