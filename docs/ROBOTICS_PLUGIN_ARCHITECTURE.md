# ATLAS Universal Robotics & Vehicle Connectivity

## Product direction

ATLAS contains one integrated connection manager. The Android ATLAS app is the phone-side hub; robots, vehicles, controllers and industrial equipment do not need to run Android. Compatible peer devices may run Linux, embedded Linux, Windows, RTOS firmware or industrial operating systems.

The connection manager is transport-neutral: each transport is implemented by an independently versioned adapter behind one common discovery, identity, health and read-only telemetry contract. A catalog entry is a compatibility target, not proof that a driver exists or that every device is supported.

## Current implementation status

- Native Android Bluetooth LE scanning is integrated in the APK and starts only after the user taps the scan button.
- Browser Web Bluetooth uses the browser's explicit device picker where supported.
- BLE device labels use the advertised name when present, resolve the standard GAP Device Name characteristic after connection when available, and otherwise display a stable device-ID suffix instead of a misleading “Unknown” label.
- A read-only BLE Environmental Sensing profile reads standard temperature (0x2A6E) and humidity (0x2A6F) characteristics when the peripheral exposes them; unsupported devices are reported honestly.
- The UI now catalogs Bluetooth Classic, Wi-Fi/LAN, Wi-Fi Direct, Ethernet, USB OTG, USB serial, CAN/CAN FD adapters, ROS 2/DDS, micro-ROS, MQTT, Modbus, OPC UA, HTTP/WebSocket, manufacturer SDKs, cameras and sensors.
- All transports other than BLE remain planned adapter integrations. They must not be displayed as connected or operational until their native driver/gateway and tests exist.
- The app currently supports BLE discovery and read-only snapshots from standard BLE Environmental Sensing temperature/humidity characteristics. It does not yet support continuous notifications for every sensor profile, proprietary sensor protocols, or robot-controller telemetry.

## Architecture

```text
ATLAS Android app
  |
  +-- Universal Connection Manager
  |     +-- Transport catalog and capability detection
  |     +-- User-approved discovery / pairing
  |     +-- Adapter lifecycle and connection health
  |     +-- Normalized device identity
  |     +-- Read-only telemetry validation
  |     +-- Audit trail and disconnect/revoke
  |
  +-- Phone-native adapters
  |     +-- Bluetooth LE / Classic
  |     +-- Wi-Fi Direct / local network discovery
  |     +-- USB Host / OTG / serial
  |     +-- USB-C Ethernet (where supported)
  |
  +-- Network and edge adapters
        +-- HTTP / WebSocket / MQTT over TLS
        +-- ROS 2 / DDS through a same-LAN edge gateway
        +-- micro-ROS through a ROS 2 Agent
        +-- CAN / CAN FD through compatible USB or Ethernet gateways
        +-- Modbus TCP / RTU and OPC UA through authenticated gateways
        +-- Vendor SDKs and camera/sensor bridges

Independent equipment safety controller
  +-- physical emergency stop
  +-- watchdog and hardware interlocks
  +-- manufacturer safety functions
```

Cloudflare Workers cannot directly access a phone's USB, Bluetooth, CAN, GPIO, camera or private LAN. The phone app uses native APIs for local peripherals. Network-connected equipment can be reached through supported protocols and explicit endpoints. Protocols such as ROS 2/DDS, CAN and industrial serial buses may require an edge computer or hardware adapter; ATLAS must identify that dependency rather than pretending the phone can speak every bus directly.

## Transport adapter matrix

| Transport | Expected integration path | Current status |
|---|---|---|
| Bluetooth LE | Native Android BLE + standard GAP/Environmental Sensing GATT reads | Implemented for discovery, name resolution and read-only temperature/humidity snapshots; physical-device validation pending |
| Bluetooth Classic | Native Android Bluetooth profiles | Planned |
| Wi-Fi / LAN | mDNS/SSDP or known authenticated endpoint | Planned |
| Wi-Fi Direct | Native Android Wi-Fi P2P | Planned |
| Ethernet | USB-C Ethernet or edge gateway | Planned |
| USB OTG / Host | Android USB Host API | Planned |
| USB Serial | Compatible USB-UART driver and allowlisted parser | Planned |
| CAN / CAN FD | Certified USB-CAN or Ethernet-CAN adapter | Planned |
| ROS 2 / DDS | Same-LAN ROS 2 edge gateway | Planned |
| micro-ROS | micro-ROS Agent via ROS 2 gateway | Planned |
| MQTT | TLS broker and read-only topic subscriptions | Planned |
| Modbus TCP / RTU | Authenticated gateway and read-only register allowlist | Planned |
| OPC UA | Certificate-validated endpoint and read-only node allowlist | Planned |
| HTTP / WebSocket | TLS device API and health/telemetry schema | Planned |
| Manufacturer SDKs | Versioned vendor-specific adapter | Planned |
| Cameras / sensors | USB, network or vendor bridge | Planned |

## Common adapter contract

Every adapter should expose:

- `describe()`: adapter ID, publisher, version, transport and capabilities.
- `discover()`: discover only devices authorized by the operator.
- `connectReadOnly(deviceId)`: open a read-only session.
- `getHealth()`: connected state, errors and last-seen time.
- `subscribeTelemetry(stream, options)`: validated normalized readings.
- `disconnect()`: release resources and permissions.

Manifests must use stable IDs and declare only `device.discovery` and `telemetry.read` in this phase. Reject unknown capabilities, elevated permissions, unsigned production plugins and actuation-enabled descriptors.

Normalized telemetry includes device ID, sensor ID, numeric value, unit, timestamp, quality, stale status and source adapter. Validate timestamps, units, payload size and finite values. Invalid or stale readings must be visibly marked.

## Security and safety

1. Request transport permissions only after the user initiates the relevant connection.
2. Show the manufacturer, device identity, adapter publisher and protocol before pairing.
3. Use TLS and authenticated sessions for network adapters; never store secrets in browser local storage.
4. Apply endpoint, topic, node and register allowlists.
5. Do not accept arbitrary shell commands, raw CAN frames, arbitrary DDS publishing or unrestricted protocol pass-through from the AI.
6. Keep this initial adapter API read-only. No motor, steering, flight, servo, gripper or other actuator API is included.
7. Any later physical-control subsystem requires separate threat modelling, independent safety controller, physical emergency stop, watchdog, interlocks, operator authorization and supervised hardware validation.
8. Loss of communication, stale telemetry or invalid safety heartbeat must be handled by the independent equipment controller, not by the cloud model or phone.

## Roadmap

1. **Transport catalog and adapter contract:** implemented in the ATLAS UI and registry.
2. **Native BLE discovery and standard environmental reads:** implemented; needs testing against real supported BLE devices.
3. **BLE notifications and additional sensor profiles:** next adapter milestone, with explicit per-profile support.
4. **USB OTG/serial:** native permission and device-driver integration.
5. **Edge gateway:** ROS 2/DDS, micro-ROS, CAN and industrial protocols.
6. **Telemetry normalization:** hardware-in-the-loop tests for each adapter.
7. **Separate safety review:** any future physical actuation is a distinct project milestone.

## Honest compatibility statement

ATLAS is being designed as a multi-transport platform, not a Bluetooth-only app. At this point, only BLE discovery has an implemented Android adapter. Listing a transport does not mean its driver, gateway, hardware compatibility or telemetry parser is already working.
