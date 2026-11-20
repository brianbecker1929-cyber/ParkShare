import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

test("Driver navigation exposes personal transactions without Host management pages", () => {
  const start = app.indexOf("  const tabs = user?.role === \"host\"");
  assert.notEqual(start, -1);
  const snippet = app.slice(start, app.indexOf(";", start) + 1);
  const driverTabs = snippet.split(":")[1];
  assert.deepEqual(JSON.parse(driverTabs.trim().replace(/;$/, "")),
    ["Browse","Discover","My Bookings","Messages","Transactions","Profile"]);
});

test("Host-only pages are guarded even on direct route navigation", () => {
  assert.match(app, /const requireHost = \(content\) => \{/);
  assert.match(app, /if \(user\?\.role === "host"\) return content;/);
  assert.match(app, /tab === "List Your Driveway" && requireHost\(/);
  assert.match(app, /tab === "Host Dashboard" && requireHost\(/);
  assert.match(app, /tab === "Transactions" && requireAuth\(user\?\.role === "driver"/);
  assert.match(app, /: requireHost\(<TransactionsView key=\{"host:" \+ user\?\.id\}/);
});

test("Public Host information remains accessible without Host permission", () => {
  assert.match(app, /screen === "host" \? \(/);
  assert.match(app, /<HostPage/);
});
