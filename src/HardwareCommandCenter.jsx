import React, { useState } from "react";
import { Activity, LockKeyhole, ShieldCheck } from "lucide-react";
import { HARDWARE_COMMAND_DEVICE_CLASSES, HARDWARE_COMMAND_REQUIRED_SAFETY_SIGNALS, evaluateHardwareControlReadiness } from "./roboticsCommandBroker.js";

const safetyLabels = {
  emergencyStopReleased: "Physical emergency stop released",
  interlocksHealthy: "Hardware interlocks healthy",
  watchdogHealthy: "Independent watchdog healthy",
  limitsVerified: "Manufacturer movement limits verified",
  controllerOnline: "Controller connection authenticated"
};

export default function HardwareCommandCenter() {
  const [message] = useState("No vendor-approved motion adapter is registered. Hardware commands are not being sent.");
  const [deviceId] = useState("");
  const [profile] = useState(null);
  const [safetyStatus] = useState({});
  const readiness = evaluateHardwareControlReadiness({ profile, deviceId, safetyStatus });

  return <section className="hardware-command-center">
    <div className="hardware-command-heading">
      <div><span className="hardware-command-icon"><Activity size={19}/></span><div><h2>SUPERVISED HARDWARE COMMAND SYSTEM</h2><p>Command framework for approved motors, actuators, servos and grippers.</p></div></div>
      <span className="badge">ADAPTER NOT REGISTERED</span>
    </div>
    <div className="hardware-command-notice"><LockKeyhole size={18}/><p><b>Physical command dispatch is not active.</b> ATLAS can prepare a request only after a vendor-approved device profile and independent safety signals are verified. No command is sent by this screen.</p></div>
    <div className="hardware-command-body">
      <div className="hardware-device-field"><span>Connected device identity</span><div>Waiting for an authenticated hardware adapter</div></div>
      <div className="hardware-device-types">{HARDWARE_COMMAND_DEVICE_CLASSES.map(name=><span key={name}>{name}</span>)}</div>
      <div className="hardware-safety-checks"><b><ShieldCheck size={16}/> INDEPENDENT SAFETY READINESS</b>{HARDWARE_COMMAND_REQUIRED_SAFETY_SIGNALS.map(signal=><div key={signal}><span>{safetyLabels[signal]}</span><strong>Not verified</strong></div>)}</div>
      <div className="hardware-command-footer"><span>{readiness.ready ? "Ready for supervised request review" : "Waiting for approved adapter and verified safety signals"}</span><button disabled>Prepare command request</button></div>
    </div>
    <p className="hardware-command-feedback" role="status">{message}</p>
  </section>;
}
