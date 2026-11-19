# ATLAS Robotics live read-only adapters

This phase adds real browser API adapters without claiming that hardware is connected:

- **HTTP telemetry:** authenticated, read-only JSON GET with no-store caching, omitted browser credentials, redirect rejection and telemetry normalization.
- **WebSocket telemetry:** receive-only JSON feed; remote endpoints must use WSS. ATLAS never sends application messages.
- **USB Serial:** user-selected Web Serial port; reads bounded JSON-lines telemetry only.
- **USB host selection:** user-mediated WebUSB device selection and descriptor reporting only. No vendor commands or arbitrary transfers.
- **Camera preview:** local video-only capture; no microphone and no upload.

## Required endpoint contract

An HTTP endpoint returns either one telemetry object, an array, or an object with a `telemetry` array. Each row should include `deviceId`, `sensorId`, numeric `value`, `unit`, and an ISO timestamp. A WebSocket feed sends the same JSON shape. The USB Serial adapter accepts one JSON object per line.

## Still gateway / hardware dependent

Bluetooth Classic, Wi-Fi Direct, CAN/CAN-FD, ROS 2/DDS, micro-ROS, MQTT, Modbus, OPC UA, and manufacturer SDKs need a compatible native driver or edge gateway plus device-specific configuration. Wi-Fi/LAN and Ethernet can use the HTTP or WebSocket adapter when the device exposes a documented telemetry endpoint; these browser APIs do not provide unrestricted LAN discovery. This PR does not mark these protocols as implemented.

All adapters are discovery / telemetry only. No actuator commands, register writes, robot motion, vehicle control, drone control, or industrial setpoint changes are exposed. Use independent hardware safety interlocks and emergency-stop systems; ATLAS does not replace them.

## Validation

Unit tests use mocked browser APIs. Real-device validation still requires supported hardware, browser permissions, an endpoint or serial protocol, and a supervised test environment.
