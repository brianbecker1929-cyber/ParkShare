import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAuthSessionSynchronizer } from "../src/lib/authSessionSync.js";

const DRIVER_ID = "driver-1";
const OTHER_ID = "other-user";
const session = (id = DRIVER_ID) => ({ access_token: "test-private-token", user: { id, email: id + "@example.test" } });

function fakeClient() {
  let onEvent;
  let latest = null;
  let loadProfile = async id => ({ data: { id, name: "Driver " + id, role: "driver" }, error: null });
  let unsubscribed = false;
  const client = {
    auth: {
      onAuthStateChange: listener => {
        onEvent = listener;
        return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } };
      },
      getSession: async () => ({ data: { session: latest }, error: null }),
    },
    from: table => {
      assert.equal(table, "profiles");
      return {
        select: fields => {
          assert.equal(fields, "id, name, role");
          return {
            eq: (field, id) => {
              assert.equal(field, "id");
              return { single: () => loadProfile(id) };
            },
          };
        },
      };
    },
  };
  return {
    client,
    emit: (event, nextSession) => { latest = nextSession; onEvent(event, nextSession); },
    setProfile: reader => { loadProfile = reader; },
    wasUnsubscribed: () => unsubscribed,
  };
}

function harness() {
  const fake = fakeClient();
  const changes = [], tasks = [], notices = [];
  const stop = createAuthSessionSynchronizer({
    client: fake.client,
    buildUser: (profile, authUser) => ({ id: authUser.id, role: profile.role, name: profile.name }),
    onUser: (user, reason) => changes.push({ user, reason }),
    onRecovery: () => notices.push("recovery"),
    onProfileUnavailable: () => notices.push("profile"),
    defer: task => tasks.push(task),
  });
  return { ...fake, changes, notices, tasks, stop, run: async () => { const next = tasks.shift(); assert.ok(next); await next(); } };
}

test("BUG-005129: sign-in in another browser tab hydrates Driver profile and restores booking identity", async () => {
  const h = harness();
  h.emit("INITIAL_SESSION", null);
  assert.equal(h.changes.at(-1).user, null);
  h.emit("SIGNED_IN", session());
  assert.equal(h.changes.at(-1).user, null, "listener should not act on unverified profile");
  assert.equal(h.tasks.length, 1, "Supabase reads must run after auth callback");
  await h.run();
  assert.deepEqual(h.changes.at(-1).user, { id: DRIVER_ID, role: "driver", name: "Driver " + DRIVER_ID });
  h.stop();
  assert.equal(h.wasUnsubscribed(), true);
});

test("BUG-005128: sign-out elsewhere clears displayed booking identity without clearing booking context", async () => {
  const h = harness();
  h.emit("SIGNED_IN", session());
  await h.run();
  h.emit("SIGNED_OUT", null);
  assert.deepEqual(h.changes.at(-1), { user: null, reason: "SIGNED_OUT" });
  h.stop();
});

test("a slow sign-in profile lookup cannot reinstate a signed-out account", async () => {
  const h = harness();
  let release;
  h.setProfile(() => new Promise(resolve => { release = resolve; }));
  h.emit("SIGNED_IN", session());
  const loading = h.run();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(typeof release, "function");
  h.emit("SIGNED_OUT", null);
  release({ data: { id: DRIVER_ID, role: "driver", name: "Stale" }, error: null });
  await loading;
  assert.equal(h.changes.at(-1).user, null);
  assert.equal(h.changes.filter(x => x.user?.name === "Stale").length, 0);
  h.stop();
});

test("rapid account switching discards stale results and uses the active session", async () => {
  const h = harness();
  h.emit("SIGNED_IN", session());
  h.emit("SIGNED_IN", session(OTHER_ID));
  await h.run();
  await h.run();
  const published = h.changes.filter(change => change.user);
  assert.equal(published.length, 1);
  assert.equal(published[0].user.id, OTHER_ID);
  h.stop();
});

test("token refresh rehydrates current profile and an unavailable profile fails closed", async () => {
  const h = harness();
  h.emit("SIGNED_IN", session());
  await h.run();
  h.setProfile(async () => ({ data: null, error: { message: "Unavailable" } }));
  h.emit("TOKEN_REFRESHED", session());
  await h.run();
  assert.deepEqual(h.changes.at(-1), { user: null, reason: "PROFILE_UNAVAILABLE" });
  assert.deepEqual(h.notices, ["profile"]);
  h.stop();
});

test("recovery events show recovery screen and unmount cancels pending work", async () => {
  const h = harness();
  h.emit("PASSWORD_RECOVERY", session());
  assert.deepEqual(h.notices, ["recovery"]);
  assert.deepEqual(h.changes, [{ user: null, reason: "PASSWORD_RECOVERY" }]);
  h.changes.length = 0;
  h.emit("SIGNED_IN", session());
  h.stop();
  await h.run();
  assert.equal(h.changes.length, 0);
});

test("App wires cross-tab login, preserves Browse listing state, and explains sign-out", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /createAuthSessionSynchronizer\(\{/);
  assert.match(app, /client: supabase/);
  assert.match(app, /onUser: \(nextUser\) => setUser\(nextUser\)/);
  assert.match(app, /screen === "app" && \(tab === "Browse" \|\| requestedRoute\.private\)/);
  assert.match(app, /Your session is signed out\. Sign in to continue booking/);
  assert.match(app, /onRequestSignIn=\{onRequestSignIn\}/);
  assert.match(app, /Sign in\s*<\/button>/);
  assert.match(app, /setSelectedVehicleId\(current => bookableVehicles\.some/);
  assert.match(app, /if \(!user\) \{\s*setShowPayment\(false\)/);
  assert.match(app, /if \(!checkoutModalActive\.current\) return;/);
  assert.match(app, /lastBookingUserId\.current !== nextId/);
  const guardAt = app.indexOf("if (!checkoutModalActive.current) return;");
  const redirectAt = app.indexOf("window.location.assign(data.url); // hand off to Stripe");
  assert.ok(guardAt >= 0 && guardAt < redirectAt,
    "a closed checkout modal must not redirect after cross-tab sign-out");
});
