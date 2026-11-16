import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHardwareControlReadiness, isHardwareCommandRequestFresh, prepareHardwareCommandRequest, validateMotionAdapterProfile } from "./roboticsCommandBroker.js";

const profile = { id: "atlas.vendor-servo", deviceClass: "servo", transport: "vendor-sdk", safetyClass: "supervised-control", vendorApproved: true, independentlySafetyReviewed: true, approvedCommands: ["hold", "return_to_safe_state"] };
const safeStatus = { emergencyStopReleased: true, interlocksHealthy: true, watchdogHealthy: true, limitsVerified: true, controllerOnline: true };

test("rejects profiles without vendor approval and independent safety review", () => {
  assert.equal(validateMotionAdapterProfile({ ...profile, vendorApproved: false }).valid, false);
  assert.equal(validateMotionAdapterProfile({ ...profile, independentlySafetyReviewed: false }).valid, false);
  assert.equal(validateMotionAdapterProfile({ ...profile, approvedCommands: ["free form movement"] }).valid, false);
});

test("hardware readiness requires every independent safety signal", () => {
  assert.equal(evaluateHardwareControlReadiness({ profile, deviceId: "device-1", safetyStatus: safeStatus }).ready, true);
  assert.equal(evaluateHardwareControlReadiness({ profile, deviceId: "device-1", safetyStatus: { ...safeStatus, interlocksHealthy: false } }).ready, false);
  assert.equal(evaluateHardwareControlReadiness({ profile, deviceId: "", safetyStatus: safeStatus }).ready, false);
});

test("prepares only an approved, confirmed, short-lived command request", () => {
  const request = prepareHardwareCommandRequest({ profile, deviceId: "device-1", commandId: "hold", operatorAuthorized: true, operatorConfirmed: true, safetyStatus: safeStatus, now: 10000, ttlMs: 5000 });
  assert.equal(request.dispatchState, "prepared-not-dispatched");
  assert.equal(request.requiresIndependentHardwareGate, true);
  assert.equal(isHardwareCommandRequestFresh(request, 12000), true);
  assert.equal(isHardwareCommandRequestFresh(request, 16000), false);
});

test("rejects unapproved commands, missing confirmation and unsafe readiness", () => {
  const base = { profile, deviceId: "device-1", operatorAuthorized: true, operatorConfirmed: true, safetyStatus: safeStatus, now: 10000 };
  assert.throws(() => prepareHardwareCommandRequest({ ...base, commandId: "arbitrary-command" }), /approved command list/);
  assert.throws(() => prepareHardwareCommandRequest({ ...base, commandId: "hold", operatorConfirmed: false }), /explicit command confirmation/);
  assert.throws(() => prepareHardwareCommandRequest({ ...base, commandId: "hold", safetyStatus: { ...safeStatus, watchdogHealthy: false } }), /safety readiness/);
});

test("prepared requests are explicitly not dispatched", () => {
  const request = prepareHardwareCommandRequest({ profile, deviceId: "device-1", commandId: "hold", operatorAuthorized: true, operatorConfirmed: true, safetyStatus: safeStatus, now: 10000 });
  assert.equal(request.dispatchState, "prepared-not-dispatched");
  assert.equal("dispatch" in request, false);
});
