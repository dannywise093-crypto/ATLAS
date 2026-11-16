# ATLAS Supervised Hardware Command Framework

## Purpose

ATLAS is intended to support real equipment integrations for motors, actuators, servos and grippers. The command framework is separate from the read-only discovery bridge so a telemetry adapter cannot silently gain motion privileges.

## Current implementation

- A typed command-request contract supports vendor-approved device profiles for motor, actuator, servo and gripper device classes.
- A profile must identify its transport, declare supervised-control safety, include vendor approval and independent safety review, and list stable approved command identifiers.
- A request requires an authenticated device identity, explicit operator authorization and confirmation, plus positive independent safety signals for the physical emergency stop, interlocks, watchdog, verified movement limits and controller connection.
- Requests expire after a short configurable lifetime and are marked `prepared-not-dispatched`.
- The current application does not register a physical motion adapter and does not dispatch requests to equipment. This remains disabled until a specific manufacturer/model interface and independent safety integration have been reviewed and tested.

## Integration boundary

The read-only robotics bridge remains read-only. Motion-capable adapters must be separately versioned and reviewed; they must not be loaded as ordinary discovery plugins. The command broker validates request metadata only. It does not translate free-form AI text into low-level motor values, raw bus frames, arbitrary register writes or generic protocol payloads.

A future manufacturer-specific integration must provide its own documented command mapping, authentication, device identity, independent safety-controller interface, fault handling and hardware-in-the-loop evidence. ATLAS must never override the equipment's own emergency stop, interlocks, watchdog or movement limits. Loss of communications or invalid safety status must leave the independent equipment controller responsible for its safe state.

## Hardware-specific commissioning

No universal adapter can safely operate every motor, servo, actuator or gripper. The exact manufacturer, model, firmware, approved SDK/protocol and safety controller are required before implementing a physical adapter. The generic framework must not claim physical control merely because a transport is available.
