import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { renderParkingSpotImage } from "../api/_driveway-image.js";
import { renderHostLogoPng, renderHostPortraitPng, renderDriverPortraitPng } from "../api/_host-logo.js";

function response() {
  return {
    code: 200, body: null,
    status(n) { this.code = n; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

// Exercise the real cron and signed-webhook handlers against a fake transport.
// Query projections are honoured: forgetting to SELECT the vehicle or spots
// reproduces the original bug instead of silently returning extra fixture data.
test("all five delivered emails retain the booked vehicle and configured Spot B", async () => {
  const env = {
    STRIPE_SECRET_KEY: "sk_test_sample_only", STRIPE_WEBHOOK_SECRET: "whsec_sample_only",
    SUPABASE_URL: "https://sample.invalid", SUPABASE_ANON_KEY: "sample-anon",
    SUPABASE_SERVICE_ROLE_KEY: "sample-service", RESEND_API_KEY: "sample-resend",
    CRON_SECRET: "sample-cron",
  };
  const savedEnv = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  const originalFetch = globalThis.fetch;
  const sent = [];
  let booking = {
    id: 42, listing_id: 7, renter_id: "sample-renter", hours: 1,
    paid_at: new Date(Date.now() - 35 * 60_000).toISOString(),
    booking_date: null, start_hour: null, spot_label: "B",
    vehicle_type: "primary", vehicle_make: "INFINITI", vehicle_model: "Q30",
    vehicle_colour: "Yellow", license_plate: "DEMO 123",
    reminder_halfway_sent_at: null, reminder_ending_sent_at: null,
  };
  const listing = {
    title: "Sample driveway", address: "12 Example Crescent", spaces: 1,
    spots: [{ forRent: false }, { forRent: true }, { forRent: false }, { forRent: false }],
    host_id: "sample-host",
  };
  const project = (row, url) => {
    const fields = url.searchParams.get("select");
    return fields ? Object.fromEntries(fields.split(",").map(k => [k, row[k]])) : row;
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init.method || "GET";
    if (url.href === "https://api.resend.com/emails") {
      sent.push(JSON.parse(init.body));
      return Response.json({ id: `sample-email-${sent.length}` });
    }
    assert.equal(url.hostname, "sample.invalid", "No real network access in delivery test");
    const table = url.pathname.split("/").at(-1);
    let result;
    if (table === "bookings") {
      if (method === "PATCH") Object.assign(booking, JSON.parse(init.body));
      if (method === "POST") booking = { ...booking, ...JSON.parse(init.body) };
      result = project(booking, url);
    } else if (table === "listings") result = project(listing, url);
    else if (table === "profiles") {
      const isHost = url.searchParams.get("id") === "eq.sample-host";
      result = project({ name: isHost ? "Sample Host" : "Sample Driver", email: isHost ? "host@example.invalid" : "driver@example.invalid" }, url);
    } else if (table === "booking_extensions") result = { id: 1, booking_id: 42, added_hours: 1 };
    else assert.fail("Unexpected table " + table);
    const singular = new Headers(init.headers).get("accept")?.includes("object+json");
    return Response.json(singular ? result : [result]);
  };
  try {
    const { default: reminders } = await import("../api/send-reminders.js");
    const { default: webhook } = await import("../api/stripe-webhook.js");
    const { stripe } = await import("../api/_lib.js");
    let res = response();
    await reminders({ method: "GET", headers: { authorization: "Bearer sample-cron" } }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { halfwaySent: 1, endingSent: 0, failed: 0 });
    booking.paid_at = new Date(Date.now() - 50 * 60_000).toISOString();
    res = response();
    await reminders({ method: "GET", headers: { authorization: "Bearer sample-cron" } }, res);
    assert.deepEqual(res.body, { halfwaySent: 0, endingSent: 1, failed: 0 });
    res = response();
    await reminders({ method: "GET", headers: { authorization: "Bearer sample-cron" } }, res);
    assert.deepEqual(res.body, { halfwaySent: 0, endingSent: 0, failed: 0 });
    async function deliver(metadata) {
      const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: {
        id: "cs_sample", payment_status: "paid", metadata,
      } } });
      const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
      const req = Readable.from([Buffer.from(payload)]);
      req.method = "POST";
      req.headers = { "stripe-signature": signature };
      res = response();
      await webhook(req, res);
      assert.equal(res.code, 200);
    }
    await deliver({ type: "extension", booking_id: "42", added_hours: "1", total_cents: "500" });
    await deliver({ listing_id: "7", renter_id: "sample-renter", hours: "1", total_cents: "1235",
      subtotal_cents: "1000", service_fee_cents: "235",
      spot_label: "B", vehicle_type: "primary", vehicle_make: "INFINITI", vehicle_model: "Q30",
      vehicle_colour: "Yellow", license_plate: "DEMO 123", start_hour: "", end_hour: "",
    });
    assert.equal(sent.length, 5, "Halfway, ending, extension, Driver and Host confirmations");
    for (const [index, label, amount] of [[2, "Amount charged", "5.00"], [3, "Total charged", "12.35"], [4, "Total charged to Driver", "12.35"]]) {
      const html = sent[index].html;
      const charge = `${label}: <strong style="color:#0e1b2e;">$${amount} CAD</strong>`;
      assert.ok(html.includes(charge), "Display the full checkout total, not the parking subtotal or payout");
      assert.ok(html.indexOf(charge) > html.indexOf("Toronto local time"));
      assert.ok(html.indexOf(charge) < html.indexOf("Reserved space ·"));
    }
    for (const email of sent.slice(0, 2)) assert.doesNotMatch(email.html, /Total charged:|Amount charged:/);

    // When a late run misses halfway, or a 30-minute session reaches its
    // midpoint, both thresholds are due. Only send the ending-soon email.
    for (const hours of [1, 0.5]) {
      Object.assign(booking, { hours, booking_date: null, start_hour: null,
        paid_at: new Date(Date.now() - (hours * 60 - 14) * 60_000).toISOString(),
        reminder_halfway_sent_at: null, reminder_ending_sent_at: null });
      const before = sent.length;
      res = response();
      await reminders({ method: "GET", headers: { authorization: "Bearer sample-cron" } }, res);
      assert.deepEqual(res.body, { halfwaySent: 0, endingSent: 1, failed: 0 });
      assert.equal(sent.length, before + 1, "Never send both reminders together");
      assert.equal(sent.at(-1).subject, "Your parking session ends soon");
    }
    const expected = await renderParkingSpotImage([false, true, false, false], 1, booking);
    const expectedLogo = await renderHostLogoPng();
    const expectedHostPortrait = await renderHostPortraitPng();
    const expectedDriverPortrait = await renderDriverPortraitPng();
    for (const email of sent) {
      const isHost = email.subject.startsWith("New driveway reservation");
      const portrait = email.attachments.find(a => a.filename === `parkshare-${isHost ? "william" : "parker"}-portrait.png`);
      assert.ok(portrait, email.subject + " must embed the correct mascot");
      assert.deepEqual(Buffer.from(portrait.content, "base64"), isHost ? expectedHostPortrait : expectedDriverPortrait);
      assert.ok(email.html.includes(`cid:${portrait.content_id}`));
      assert.equal(email.attachments.some(a => a.filename === `parkshare-${isHost ? "parker" : "william"}-portrait.png`), false);
      assert.match(email.html, /Q30/);
      assert.match(email.html, /DEMO 123/);
      assert.match(email.html, /PK-42/);
      assert.match(email.html, /Toronto local time/);
      const logo = email.attachments.find(a => a.filename === "parkshare-signature-logo.png");
      assert.ok(logo, email.subject + " missing the approved inline logo");
      assert.deepEqual(Buffer.from(logo.content, "base64"), expectedLogo);
      assert.ok(email.html.includes(`cid:${logo.content_id}`));
      assert.doesNotMatch(email.html, /email\/logo\.png|\[BOOKING_LOGO_URL\]/);
      const map = email.attachments.find(a => a.filename === "parking-spot.png");
      assert.ok(map, email.subject + " missing the inline driveway");
      assert.deepEqual(Buffer.from(map.content, "base64"), expected, email.subject + " changed the saved vehicle or private bays");
      assert.ok(email.html.includes(`cid:${map.content_id}`));
      assert.match(email.html, /width="180"/);
      assert.doesNotMatch(email.html, /height:260px; width:auto/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
