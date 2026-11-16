# ATLAS Integrated Universal Robotics Bridge

## Status

This document defines the first, vendor-neutral integration contract for ATLAS. The Android ATLAS application is intended to host the phone-side connection layer directly; a separately installed Local Robotics Bridge application is not part of the product design. The current build still does **not** discover devices, connect to a controller, or read physical sensors. It includes simulation-ready adapter contracts and read-only telemetry validation only.

## Design goals

- Support different manufacturers and controller boards through independently versioned adapters.
- Keep the cloud AI separate from time-critical robot control.
- Make adapter identity, device identity, supported telemetry and permissions explicit.
- Start with simulated devices and read-only discovery/telemetry.
- Keep motor and actuator control disabled unless a later, separately reviewed implementation adds the required independent safety system.

## Architecture

```text
ATLAS Web / Android UI
        |
        | authenticated, scoped session (future)
        v
ATLAS Local Robotics Bridge (future; runs on a supported edge computer)
        |
        +-- Plugin Manager / Adapter Registry
        |      +-- ROS 2 / DDS adapter
        |      +-- micro-ROS adapter
        |      +-- USB / serial adapter
        |      +-- CAN telemetry adapter
        |      +-- Ethernet / TCP adapter
        |      +-- Manufacturer SDK adapter
        |      +-- Camera and sensor adapters
        |
        +-- Read-only Device Discovery
        +-- Normalized Telemetry Gateway
        +-- Audit Log and Health Monitor

Separate, independent robot safety controller
        +-- physical emergency stop
        +-- watchdog and interlocks
        +-- manufacturer safety functions
```

The Cloudflare Worker cannot directly access a user's USB, UART, CAN, GPIO, camera, or local network hardware. The Android ATLAS app must use native Android/Capacitor interfaces for supported phone peripherals. Robots that do not run Android connect as peers over compatible network protocols or supported adapters; the robot operating system does not need to be Android. CAN and GPIO require compatible external hardware. The web build remains capability-limited.

## Adapter families

| Adapter family | Intended first-phase scope | Example ecosystem |
|---|---|---|
| ROS 2 / DDS | Node and topic discovery; read-only topic telemetry | ROS 2 distributions and DDS vendors |
| micro-ROS | Agent/device identity and telemetry | Supported microcontroller clients |
| USB / serial | Port identity and allowlisted telemetry frames | Generic serial controllers and dev boards |
| CAN | Read-only bus/device health and approved telemetry | CAN-compatible controllers |
| Ethernet / TCP | Authenticated device identity and telemetry | LAN robot controllers |
| Vendor SDK | Vendor-specific discovery and telemetry wrapped in the common contract | NVIDIA/Jetson ecosystem and other manufacturers |
| Sensors | Timestamped, unit-labelled sensor values | IMU, encoders, range, force, temperature |
| Vision | Camera metadata and approved image streams | USB, CSI and Ethernet cameras |

This is a compatibility target, not a claim that every listed adapter is implemented or tested.

## Plugin manifest contract

Each adapter should ship a signed or integrity-checked manifest with at least:

```json
{
  "schemaVersion": "1.0",
  "pluginId": "vendor.transport.adapter",
  "displayName": "Example telemetry adapter",
  "version": "0.1.0",
  "vendor": "Adapter publisher",
  "transport": "serial",
  "supportedDevices": [],
  "capabilities": ["device.discovery", "telemetry.read"],
  "permissions": ["device.identity", "telemetry.read"],
  "safetyClass": "read-only",
  "entrypoint": "adapter module entrypoint",
  "signature": "publisher signature metadata"
}
```

The example is a schema illustration, not an executable plugin. Unknown permissions, unsigned production plugins, duplicate IDs, unsupported schema versions and capability escalation must be rejected.

## Normalized read-only interface

An adapter implementation should expose equivalent operations regardless of vendor:

- `describe()`: return manifest identity, version, transport and declared capabilities.
- `discover()`: enumerate only explicitly authorized devices; no automatic pairing.
- `connectReadOnly(deviceId)`: establish a read-only session to an approved device.
- `getHealth()`: report connection state, errors and last-seen timestamp.
- `subscribeTelemetry(stream, options)`: return normalized, timestamped telemetry.
- `disconnect()`: close the session and release resources.

Normalized telemetry should include `deviceId`, `sensorId`, `value`, `unit`, `timestamp`, `quality`, and `sourcePlugin`. Validate payload size, schema, units, timestamps and finite numeric values. Mark stale or invalid readings rather than silently treating them as current.

## Security and safety requirements

1. Default-deny plugin permissions; request only the minimum required.
2. Pair devices explicitly and show the device identity and adapter publisher to the operator.
3. Keep credentials and signing keys outside browser storage and source control.
4. Authenticate bridge sessions, use encryption in transit, rotate credentials and log pairing/revocation.
5. Do not accept arbitrary shell commands, raw pass-through frames, or arbitrary topic publishing from the AI.
6. The initial adapter API is read-only. No motor, servo, gripper, steering, flight, or other actuator command API is included.
7. A future motion-control proposal requires separate threat modelling, code review, simulation, operator confirmation and independently enforced hardware safety limits.
8. Emergency stop must be a physical, independent mechanism and must not depend on ATLAS, a network, cloud inference or a phone.
9. A communication timeout, stale telemetry, invalid units, bridge crash or loss of safety heartbeat must fail safe at the independent controller.
10. Test with mock devices and simulation before any supervised physical evaluation.

## Implementation roadmap

- **Phase 1 — Architecture and UI:** vendor-neutral adapter families, explicit offline state, safety messaging. Implemented in the Robotics Center UI.
- **Phase 2 — Contract and mock adapters:** validate manifests and normalized read-only telemetry using simulated devices only.
- **Phase 3 — Local bridge:** design a least-privilege bridge for a supported edge OS; no actuator permissions.
- **Phase 4 — Read-only integrations:** add one adapter at a time with hardware-in-the-loop telemetry tests and documented device compatibility.
- **Phase 5 — Separate safety review:** any future actuation work must be designed and reviewed as a distinct subsystem; it is not authorized by this plugin architecture.

## Current limitations

ATLAS currently has no installed robotics bridge, no connected robot, no live adapter registry and no hardware telemetry endpoint. The UI lists planned adapter families only. A displayed adapter is not evidence of device support or a working connection.
