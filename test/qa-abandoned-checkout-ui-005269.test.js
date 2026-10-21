import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { listingSpotStatusText } from "../src/lib/spotAvailability.js";
import { getListingSpotLayout } from "../src/lib/listingSpotLayout.js";

const source = await readFile(process.env.QA_ABANDONED_APP_SOURCE || new URL("../src/App.jsx", import.meta.url), "utf8");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const session = id => ({ data: { session: id ? { user: { id }, access_token: `${id}-token` } : null }, error: null });
const response = status => ({ ok: true, json: async () => ({ status }) });

const marker = source.indexOf("    let controller;", source.indexOf("const availabilityFailed"));
const effect = source.slice(source.lastIndexOf("  useEffect(() => {", marker), source.indexOf("  const chosenSpotAvailable", marker));
function refreshHarness(mode = "selected") {
  let setup, timer, stopped = false;
  const events = new Map(), requests = [], results = [], paused = { current: false }, doc = { visibilityState: "visible" };
  const add = (name, fn) => events.set(name, fn), remove = name => events.delete(name);
  const values = { useEffect: fn => { setup = fn; }, numericIdForAvailability: 7, selectedWindowKey: "7:now:1", hours: 1,
    bookingMode: "now", date: new Date(), startHour: 9, localCalendarDate: () => "2030-10-21", availabilityPaused: paused,
    setChosenSpot: () => {}, setShowPayment: () => {}, setAvailabilityResult: value => results.push(value), setLiveAvailability: data => results.push({ data }),
    window: { setInterval: (fn, ms) => { assert.equal(ms, 15000); timer = fn; return 1; }, clearInterval: () => { stopped = true; }, addEventListener: add, removeEventListener: remove },
    document: Object.assign(doc, { addEventListener: add, removeEventListener: remove }),
    fetch: async (url, options) => { const pending = deferred(); requests.push({ url, options, pending }); return pending.promise; } };
  const liveStart = source.indexOf("  useEffect(() => {", source.indexOf("const [liveAvailability"));
  const liveEffect = source.slice(liveStart, source.indexOf("  // Live check tied", liveStart));
  new Function(...Object.keys(values), mode === "live" ? liveEffect : effect)(...Object.values(values));
  assert.equal(typeof setup, "function", "Actual listing must refresh its selected availability");
  const stop = setup();
  return { requests, results, paused, doc, events, poll: () => timer(), stop, get stopped() { return stopped; } };
}
test("actual listing refreshes expired holds without changing the chosen time or requiring reload", async () => {
  const h = refreshHarness(); assert.equal(h.requests.length, 1);
  h.requests[0].pending.resolve({ ok: true, json: async () => ({ available: false, spotState: { A: "held" } }) }); await tick();
  h.poll(); h.requests[1].pending.resolve({ ok: true, json: async () => ({ available: true, spotState: { A: "available" }, spotStatus: { A: true } }) }); await tick();
  assert.equal(h.results.at(-1).data.spotState.A, "available");
  assert.equal(h.requests[1].url, h.requests[0].url); assert.equal(h.requests[0].options.cache, "no-store"); h.stop();
});
test("the available-now title badge also refreshes and rejects obsolete reads", async () => {
  const h = refreshHarness("live"); h.poll();
  h.requests[1].pending.resolve({ ok: true, json: async () => ({ spacesFree: 1 }) }); await tick();
  h.requests[0].pending.resolve({ ok: true, json: async () => ({ spacesFree: 0 }) }); await tick();
  assert.equal(h.results.length, 1); assert.equal(h.results[0].data.spacesFree, 1); h.stop();
  assert.equal(h.events.size, 0); assert.equal(h.stopped, true);
});
test("older checks cannot overwrite a fresh result and cleanup cancels timers, listeners and writes", async () => {
  const h = refreshHarness(); h.poll();
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.requests[1].pending.resolve({ ok: true, json: async () => ({ spotState: { A: "available" } }) }); await tick();
  h.requests[0].pending.resolve({ ok: true, json: async () => ({ spotState: { A: "held" } }) }); await tick();
  assert.equal(h.results.length, 1); assert.equal(h.results[0].data.spotState.A, "available");
  h.poll(); h.stop(); h.requests[2].pending.resolve({ ok: true, json: async () => ({ available: false }) }); await tick();
  assert.equal(h.results.length, 1); assert.equal(h.stopped, true); assert.equal(h.events.size, 0);
});
test("background pages and an open payment dialog pause refresh; focus and cancellation recheck", async () => {
  const h = refreshHarness(); h.doc.visibilityState = "hidden"; h.poll(); assert.equal(h.requests.length, 1);
  h.doc.visibilityState = "visible"; h.paused.current = true; h.poll(); assert.equal(h.requests.length, 1);
  h.requests[0].pending.resolve({ ok: true, json: async () => ({ available: false }) }); await tick(); assert.equal(h.results.length, 0);
  h.paused.current = false; h.events.get("focus")(); assert.equal(h.requests.length, 2);
  h.events.get("parkshare:availability-changed")(); assert.equal(h.requests.length, 3); h.stop();
});

const a = source.indexOf("function CheckoutCancellation("), b = source.indexOf("// Return URLs describe", a);
const compiled = await transform(a < 0 ? "function CheckoutCancellation(){return null;}" : source.slice(a, b), { loader: "jsx" });
function clientHarness({ auth = async () => session("A"), post = async () => response("released") } = {}) {
  const slots = [], effects = [], requests = [], dispatches = []; let cursor = 0, dirty = false, tree;
  const values = { React, C: {}, Event, useState: initial => { const n = cursor++; if (!(n in slots)) slots[n] = { value: initial }; return [slots[n].value, value => { slots[n].value = typeof value === "function" ? value(slots[n].value) : value; dirty = true; }]; },
    useEffect: (fn, deps) => { const n = cursor++, old = slots[n]; if (!old || deps.some((value, i) => value !== old.deps[i])) { slots[n] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[n].cleanup?.(); slots[n].cleanup = fn(); }); } },
    supabase: { auth: { getSession: auth } }, fetch: async (url, options) => { requests.push({ url, options }); return post(url, options); }, window: { dispatchEvent: event => dispatches.push(event.type) } };
  const Component = new Function(...Object.keys(values), compiled.code + ";return CheckoutCancellation;")(...Object.values(values));
  function render(props = {}) { let count = 0; do { dirty = false; cursor = 0; tree = Component({ holdId: "10000000-0000-4000-8000-000000000001", user: { id: "A" }, ...props }); for (const fn of effects.splice(0)) fn(); assert.ok(++count < 8); } while (dirty); return tree; }
  return { render, requests, dispatches, stop: () => { for (const slot of slots) slot?.cleanup?.(); }, text: () => renderToStaticMarkup(render()) };
}
test("actual cancellation UI submits an authenticated reference then refreshes availability only after acknowledgment", async () => {
  const pending = deferred(), h = clientHarness({ post: () => pending.promise }); h.render(); await tick();
  assert.equal(h.requests.length, 1); assert.equal(h.dispatches.length, 0);
  assert.equal(h.requests[0].url, "/api/cancel-booking-checkout"); assert.equal(h.requests[0].options.headers.Authorization, "Bearer A-token");
  pending.resolve(response("released")); await tick(); assert.match(h.text(), /temporary spot hold was released/);
  assert.deepEqual(h.dispatches, ["parkshare:availability-changed"]); h.stop();
});
test("signed-out or different-session users cannot initiate cancellation", async () => {
  const out = clientHarness(); out.render({ user: null }); await tick(); assert.equal(out.requests.length, 0); out.stop();
  const switched = clientHarness({ auth: async () => session("B") }); switched.render(); await tick();
  assert.equal(switched.requests.length, 0); assert.match(switched.text(), /Sign in again/); switched.stop();
});
test("obsolete authentication cannot POST after unmount and late HTTP responses cannot refresh the next account", async () => {
  const auth = deferred(), h = clientHarness({ auth: () => auth.promise }); h.render(); h.stop(); auth.resolve(session("A")); await tick(); assert.equal(h.requests.length, 0);
  const reply = deferred(), next = clientHarness({ post: () => reply.promise }); next.render(); await tick(); next.stop();
  reply.resolve(response("released")); await tick(); assert.equal(next.dispatches.length, 0); assert.match(next.text(), /Checking your unpaid/);
});
test("missing or failed acknowledgments keep cancellation unconfirmed and allow explicit retry", async () => {
  for (const reply of [{ ok: false, json: async () => ({}) }, response("unexpected"), { ok: true, json: async () => { throw Error("Unreadable response"); } }]) {
    const h = clientHarness({ post: async () => reply }); h.render(); await tick();
    assert.doesNotMatch(h.text(), /hold was released/); assert.match(h.text(), /Retry cancellation/); assert.equal(h.dispatches.length, 0); h.stop();
  }
});
test("actual bay markup labels a hold separately and never displays an old selected vehicle over a held bay", async () => {
  const start = source.indexOf("function SpotPicker("), end = source.indexOf("// Read-only booking view", start);
  const code = await transform(source.slice(start, end), { loader: "jsx" });
  const Picker = new Function("React", "C", "DrivewayFrame", "canChooseListingSpot", "listingSpotStatusText", "hasDrivewayVehicle", "DrivewayCarVisual", "getListingSpotLayout", code.code + ";return SpotPicker;")(
    React, {}, ({ children }) => React.createElement("div", null, children), ({ label, availableData }) => availableData.spotStatus[label], listingSpotStatusText, () => true, () => React.createElement("span", null, "SELECTED VEHICLE"), getListingSpotLayout);
  const html = renderToStaticMarkup(React.createElement(Picker, { availableCount: 2, chosen: 0, isRealListing: true,
    availableData: { available: true, spotStatus: { A: false, B: true }, spotState: { A: "held", B: "available" } } }));
  assert.match(html, /Checkout in progress/); assert.match(html, /up to 30 minutes/);
  assert.doesNotMatch(html, /Already booked|SELECTED VEHICLE/);
});
