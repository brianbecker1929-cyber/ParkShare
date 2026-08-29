import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return source.slice(start, end);
}

test("host cancellation modal stays inside HostDashboard", () => {
  const hostDashboard = functionSource("HostDashboard", "MessagesView");

  assert.match(hostDashboard, /actor="host"/);
  assert.match(hostDashboard, /onConfirm=\{cancelHostBooking\}/);
});

test("shared DrivewayFrame does not reference host cancellation state", () => {
  const drivewayFrame = functionSource("DrivewayFrame", "SpotPicker");

  assert.doesNotMatch(drivewayFrame, /cancelTarget|cancelBusy|cancelHostBooking/);
});
