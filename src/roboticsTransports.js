export const ROBOTICS_TRANSPORTS = Object.freeze([
  { id: "bluetooth-le", name: "Bluetooth LE", group: "Phone wireless", state: "implemented", route: "Native Android BLE scanner", scope: "Nearby BLE advertisements; explicit user-started scan." },
  { id: "bluetooth-classic", name: "Bluetooth Classic", group: "Phone wireless", state: "planned", route: "Native Android Bluetooth adapter", scope: "Requires classic-device discovery and profile-specific support." },
  { id: "wifi-lan", name: "Wi-Fi / LAN", group: "Network", state: "planned", route: "Authenticated local-network adapter", scope: "Device discovery needs mDNS/SSDP or a device-provided endpoint; Android network permissions apply." },
  { id: "wifi-direct", name: "Wi-Fi Direct", group: "Phone wireless", state: "planned", route: "Native Android Wi-Fi P2P adapter", scope: "Peer discovery and group negotiation require native Android integration." },
  { id: "ethernet", name: "Ethernet", group: "Network", state: "planned", route: "USB-C Ethernet or edge gateway", scope: "Requires compatible phone adapter or network-connected edge host." },
  { id: "usb-otg", name: "USB OTG", group: "Wired", state: "planned", route: "Native Android USB Host adapter", scope: "USB device enumeration, permission and vendor/protocol driver required." },
  { id: "usb-serial", name: "USB Serial", group: "Wired", state: "planned", route: "USB serial adapter", scope: "Requires compatible USB-UART adapter and an allowlisted telemetry protocol." },
  { id: "can-bus", name: "CAN / CAN FD", group: "Vehicle & industrial", state: "planned", route: "Certified USB-CAN or Ethernet-CAN interface", scope: "No direct phone CAN pins; adapter-specific read-only decoder and authorization required." },
  { id: "ros2-dds", name: "ROS 2 / DDS", group: "Robotics middleware", state: "planned", route: "ROS 2 edge gateway", scope: "DDS discovery commonly requires same-LAN multicast; Android is not a full ROS 2 host." },
  { id: "micro-ros", name: "micro-ROS", group: "Robotics middleware", state: "planned", route: "micro-ROS Agent via ROS 2 gateway", scope: "Agent exposes approved device identity and telemetry to ATLAS." },
  { id: "mqtt", name: "MQTT", group: "Messaging", state: "planned", route: "Authenticated MQTT broker / WebSocket", scope: "TLS, broker credentials, topic allowlists and read-only subscriptions." },
  { id: "modbus", name: "Modbus TCP / RTU", group: "Industrial", state: "planned", route: "Industrial gateway or serial adapter", scope: "Read-only register allowlists; no write-register operations in this phase." },
  { id: "opcua", name: "OPC UA", group: "Industrial", state: "planned", route: "Authenticated OPC UA gateway", scope: "Certificate validation and read-only node allowlists." },
  { id: "http-ws", name: "HTTP / WebSocket", group: "Network", state: "planned", route: "Authenticated device API", scope: "TLS endpoint with documented read-only health and telemetry contract." },
  { id: "vendor-sdk", name: "Manufacturer SDKs", group: "Vendor integrations", state: "planned", route: "Vendor-specific adapter module", scope: "Versioned, permission-scoped adapter; compatibility varies by manufacturer." },
  { id: "camera-sensors", name: "Cameras & sensors", group: "Perception", state: "planned", route: "USB, network or vendor camera adapter", scope: "Metadata and approved sensor streams; hardware and driver dependent." }
]);

export function getRoboticsTransportCatalog({ nativeAndroid = false, environment = globalThis } = {}) {
  const nav = environment.navigator || {};
  const implemented = new Set(["http-ws"]);
  if (nav.serial?.requestPort) implemented.add("usb-serial");
  if (nav.usb?.requestDevice) implemented.add("usb-otg");
  if (nav.mediaDevices?.getUserMedia) implemented.add("camera-sensors");
  return ROBOTICS_TRANSPORTS.map(item => ({
    ...item,
    state: item.id === "bluetooth-le" && nativeAndroid
      ? "available"
      : implemented.has(item.id) ? "implemented" : item.state,
    runtimeNote: implemented.has(item.id)
      ? "Browser API present; device permission and compatible hardware/endpoint still required."
      : item.id === "wifi-lan" || item.id === "ethernet"
        ? "Can use the HTTP/WebSocket telemetry gateway when a documented endpoint is supplied; direct discovery is not implemented."
        : item.state === "planned" ? "Requires a compatible native driver, edge gateway, vendor SDK, or device-specific protocol." : item.scope
  }));
}

export function validateReadOnlyAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") return { valid: false, reason: "Adapter descriptor is required." };
  if (!ROBOTICS_TRANSPORTS.some(item => item.id === adapter.transport)) return { valid: false, reason: "Unknown transport." };
  if (typeof adapter.id !== "string" || !/^[a-z0-9][a-z0-9.-]{2,95}$/.test(adapter.id)) return { valid: false, reason: "Adapter ID is invalid." };
  if (adapter.safetyClass !== "read-only") return { valid: false, reason: "Only read-only adapters are accepted." };
  if (!Array.isArray(adapter.capabilities) || !adapter.capabilities.includes("device.discovery")) return { valid: false, reason: "Device discovery capability is required." };
  if (adapter.capabilities.some(capability => !["device.discovery", "telemetry.read"].includes(capability))) return { valid: false, reason: "Unsupported or elevated adapter capability." };
  if (adapter.actuationEnabled === true) return { valid: false, reason: "Actuation is not accepted by the read-only adapter registry." };
  return { valid: true, reason: "" };
}
