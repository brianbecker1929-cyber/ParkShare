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
for (const [count, chosenLabel] of [[1, "A"], [4, "B"], [8, "H"]]) {
test(`all six delivered emails retain the vehicle and Spot ${chosenLabel} in a ${count}-bay layout`, async () => {
  const chosenIndex = chosenLabel.charCodeAt(0) - 65;
  const spotStates = Array.from({length: count}, (_, i) => i === chosenIndex);
  const env = {
    STRIPE_SECRET_KEY: "sk_test_sample_only", STRIPE_WEBHOOK_SECRET: "whsec_sample_only",
    SUPABASE_URL: "https://sample.invalid", SUPABASE_ANON_KEY: "sample-anon",
    SUPABASE_SERVICE_ROLE_KEY: "sample-service", RESEND_API_KEY: "sample-resend",
    CRON_SECRET: "sample-cron", EMAIL_FROM: "ParkShare <test@example.invalid>",
  };
  const savedEnv = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  const originalFetch = globalThis.fetch;
  const sent = [];
  const deliveries = new Map();
  let missingRecipient = false;
  let booking = {
    id: 42, listing_id: 7, renter_id: "sample-renter", hours: 1,
    paid_at: new Date(Date.now() - 35 * 60_000).toISOString(),
    booking_date: null, start_hour: null, property_time_zone: "Europe/Bucharest", spot_label: chosenLabel,
    vehicle_type: "primary", vehicle_make: "INFINITI", vehicle_model: "Q30",
    vehicle_colour: "Yellow", license_plate: "DEMO 123",
    reminder_halfway_sent_at: null, reminder_ending_sent_at: null,
    status: "confirmed", stripe_connected_account_id: "acct_sample",
    stripe_checkout_session_id: "cs_original",
  };
  const listing = {
    title: "Sample driveway", address: "12 Example Crescent", spaces: 1,
    spots: spotStates.map(forRent => ({forRent})),
    host_id: "sample-host",
  };
  const trustedHold = {
    id: "hold_sample", listing_id: 7, renter_id: "sample-renter", spot_label: chosenLabel,
    starts_at: "2026-10-15T13:00:00Z", ends_at: "2026-10-15T14:00:00Z",
    stripe_checkout_session_id: "cs_booking_sample",
    expected_total_cents: 1235, expected_connected_account_id: "acct_sample",
    checkout_metadata: {
      hold_id: "hold_sample", listing_id: "7", renter_id: "sample-renter", host_id: "sample-host",
      connected_account_id: "acct_sample", hours: "1", total_cents: "1235",
      subtotal_cents: "1000", service_fee_cents: "235", spot_label: chosenLabel,
      vehicle_type: "primary", vehicle_make: "INFINITI", vehicle_model: "Q30",
      vehicle_colour: "Yellow", license_plate: "DEMO 123", booking_date: "", start_hour: "", end_hour: "", property_time_zone: "Europe/Bucharest",
    },
  };
  const pendingExtension = {
    booking_id: 42, renter_id: "sample-renter", added_hours: 1, hold_id: "extension_hold",
    expected_total_cents: 500, expected_service_fee_cents: 65,
    expected_connected_account_id: "acct_sample",
    stripe_checkout_session_id: "cs_ext_sample",
  };
  let savedExtensionSessionId = null;
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
    if (table === "booking_reminder_deliveries") {
      const body = init.body ? JSON.parse(init.body) : null;
      const id = body?.id || url.searchParams.get("id")?.slice(3);
      if (method === "POST" && !deliveries.has(id)) deliveries.set(id, {
        ...body, created_at: new Date().toISOString(), lease_until: new Date(0).toISOString(), sent_at: null, provider_id: null,
      });
      const row = deliveries.get(id);
      if (method === "PATCH") {
        const eligible = !url.searchParams.has("sent_at") || (!row.sent_at && Date.parse(row.lease_until) <= Date.parse(url.searchParams.get("lease_until").slice(4)));
        if (eligible) Object.assign(row, body);
        else return Response.json(null);
      }
      result = row;
    } else if (table === "bookings") {
      if (method === "PATCH") Object.assign(booking, JSON.parse(init.body));
      if (method === "POST") booking = { ...booking, ...JSON.parse(init.body) };
      const requestedSession = url.searchParams.get("stripe_checkout_session_id");
      result = requestedSession && requestedSession !== "eq." + booking.stripe_checkout_session_id
        ? null : project(booking, url);
    } else if (table === "listings") result = project(listing, url);
    else if (table === "booking_holds") {
      const requested = url.searchParams.get("stripe_checkout_session_id");
      result = requested === "eq.cs_booking_sample" ? project(trustedHold, url)
        : requested === "eq.cs_ext_sample" ? project({id:"extension_hold",listing_id:7,renter_id:"sample-renter",stripe_checkout_session_id:"cs_ext_sample",checkout_metadata:null},url) : null;
    } else if (table === "pending_booking_extensions") {
      const requested = url.searchParams.get("stripe_checkout_session_id");
      result = requested === "eq.cs_ext_sample" ? project(pendingExtension, url) : null;
    }
    else if (table === "profiles") {
      const isHost = url.searchParams.get("id") === "eq.sample-host";
      result = project({ name: isHost ? "Sample Host" : "Sample Driver", email: missingRecipient && !isHost ? null : isHost ? "host@example.invalid" : "driver@example.invalid", stripe_account_id: "acct_sample" }, url);
    } else if (table === "settle_initial_booking_checkout") {
      const request=JSON.parse(init.body);
      assert.equal(request.p_hold_id,"hold_sample");
      assert.equal(request.p_payment_reversed,false);
      booking={...booking,...request.p_booking,id:42,application_state:"applied"};
      return Response.json({applied:true,refund_required:false,booking});
    } else if (table === "apply_paid_booking_extension") {
      // Model the proposed Postgres RPC as an indivisible, idempotent
      // insert + duration update. No actual Supabase instance is modified.
      const request = JSON.parse(init.body);
      assert.equal(request.p_checkout_session_id, "cs_ext_sample");
      assert.equal(request.p_payment_intent_id, "pi_ext_sample");
      assert.equal(request.p_connected_account_id, "acct_sample");
      if (savedExtensionSessionId === request.p_checkout_session_id) {
        result = { applied: false, resulting_hours: booking.hours };
      } else {
        savedExtensionSessionId = request.p_checkout_session_id;
        booking.hours += request.p_added_hours;
        result = { applied: true, resulting_hours: booking.hours };
      }
    } else if (table === "booking_extensions") {
      if (method === "POST") savedExtensionSessionId = JSON.parse(init.body).stripe_checkout_session_id;
      const requested = url.searchParams.get("stripe_checkout_session_id");
      result = requested && requested !== "eq." + savedExtensionSessionId
        ? null : { id: 1, booking_id: 42, added_hours: 1, application_state: "applied" };
    }
    else assert.fail("Unexpected table " + table);
    const singular = new Headers(init.headers).get("accept")?.includes("object+json");
    return Response.json(singular ? result : (result ? [result] : []));
  };
  try {
    const { default: reminders } = await import("../api/send-reminders.js");
    const { default: webhook } = await import("../api/stripe-webhook.js");
    const { stripe } = await import("../api/_lib.js");
    const originalRetrieve = stripe.paymentIntents.retrieve;
    const originalChargeRetrieve = stripe.charges.retrieve;
    const originalRefundList = stripe.refunds.list;
    stripe.charges.retrieve = async (id, params, options) => {assert.equal(options.stripeAccount,"acct_sample");const ext=id==="ch_ext";return {id,payment_intent:ext?"pi_ext_sample":"pi_booking_sample",currency:"cad",livemode:false,amount:ext?500:1235,amount_captured:ext?500:1235,amount_refunded:0,paid:true,captured:true,status:"succeeded"};};
    stripe.refunds.list = async () => ({data:[],has_more:false});
    stripe.paymentIntents.retrieve = async id => ({
      id, currency: "cad", status: "succeeded", livemode: false,
      amount_received: id === "pi_ext_sample" ? 500 : 1235,
      application_fee_amount: id === "pi_ext_sample" ? 65 : 235,
      latest_charge: id === "pi_ext_sample" ? "ch_ext" : "ch_book",
    });
    try {
    for (const [method, authorization, expectedStatus] of [["GET", "", 401], ["GET", "Bearer incorrect", 401], ["DELETE", "Bearer sample-cron", 405]]) {
      const rejected = response();
      await reminders({method,headers:{authorization}},rejected);
      assert.equal(rejected.code,expectedStatus);
    }
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
    async function deliver(metadata, sessionId, amountCents, paymentIntentId) {
      const payload = JSON.stringify({ id:"evt_sample",created:1792000000,livemode:false,type: "checkout.session.completed", account: "acct_sample", data: { object: {
        id: sessionId, livemode:false,created:1792000000,mode: "payment", payment_status: "paid", amount_total: amountCents,
        currency: "cad", payment_intent: paymentIntentId, metadata,
      } } });
      const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
      const req = Readable.from([Buffer.from(payload)]);
      req.method = "POST";
      req.headers = { "stripe-signature": signature };
      res = response();
      await webhook(req, res);
      assert.equal(res.code, 200);
    }
    const extensionMetadata = { type: "extension", booking_id: "42", added_hours: "1", total_cents: "500", host_email: "untrusted@example.invalid" };
    await deliver(extensionMetadata, "cs_ext_sample", 500, "pi_ext_sample");
    assert.deepEqual(sent[2].to, ["driver@example.invalid"]);
    assert.equal(sent[2].cc, undefined);
    assert.deepEqual(sent[3].to, ["host@example.invalid"], "Notify the authoritative Host separately");
    assert.equal(sent[3].cc, undefined);
    assert.match(sent[3].html, /Hi <strong>Sample Host<\/strong>/);
    for (const email of sent.slice(2,4)) assert.doesNotMatch(email.html, /driver@example.invalid|host@example.invalid|untrusted@example.invalid/);
    assert.equal(booking.hours, 2);
    await deliver(extensionMetadata, "cs_ext_sample", 500, "pi_ext_sample");
    assert.equal(sent.length, 4, "A replay cannot send another Driver or Host extension email");
    assert.equal(booking.hours, 2, "A replay cannot apply the extension twice");
    await deliver({ listing_id: "7", renter_id: "sample-renter", hours: "1", total_cents: "1235",
      subtotal_cents: "1000", service_fee_cents: "235",
      spot_label: chosenLabel, vehicle_type: "primary", vehicle_make: "INFINITI", vehicle_model: "Q30",
      vehicle_colour: "Yellow", license_plate: "DEMO 123", start_hour: "", end_hour: "",
    }, "cs_booking_sample", 1235, "pi_booking_sample");
    assert.equal(sent.length, 6, "Halfway, ending, two extension and two booking confirmations");
    for (const [index, email] of sent.entries()) {
      assert.match(email.html, /href="https:\/\/www\.myparkshare\.ca\/parking\?message_booking=42"/,
        "Every delivered email opens its booked listing conversation");
      const label = [3, 5].includes(index) ? "Message Driver" : index < 2 ? "Message" : "Message Host";
      assert.ok(email.html.includes(`>${label}</a>`));
      assert.doesNotMatch(email.html, /\[MESSAGE_URL\]/);
    }
    for (const [index, label, amount] of [[2, "Amount charged", "5.00"], [3, "Extension charged to Driver", "5.00"], [4, "Total charged", "12.35"], [5, "Total charged to Driver", "12.35"]]) {
      const html = sent[index].html;
      const charge = `${label}: <strong style="color:#0e1b2e;">$${amount} CAD</strong>`;
      assert.ok(html.includes(charge), "Display the full checkout total, not the parking subtotal or payout");
      assert.ok(html.indexOf(charge) > html.indexOf("Europe/Bucharest local time"));
      assert.ok(html.indexOf(charge) < html.indexOf("Reserved space ·"));
    }
    for (const email of sent.slice(0, 2)) assert.doesNotMatch(email.html, /Total charged:|Amount charged:/);

    // When a late run misses halfway, or a 30-minute session reaches its
    // midpoint, both thresholds are due. Only send the ending-soon email.
    for (const hours of [1, 0.5]) {
      deliveries.clear(); // Independent fixture booking, including its delivery history.
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
    const expected = await renderParkingSpotImage(spotStates, chosenIndex, booking);
    const expectedLogo = await renderHostLogoPng();
    const expectedHostPortrait = await renderHostPortraitPng();
    const expectedDriverPortrait = await renderDriverPortraitPng();
    for (const email of sent) {
      const isHost = email.subject.startsWith("New driveway reservation") || email.subject.startsWith("Parking extended");
      const portrait = email.attachments.find(a => a.filename === `parkshare-${isHost ? "william" : "parker"}-portrait.png`);
      assert.ok(portrait, email.subject + " must embed the correct mascot");
      assert.deepEqual(Buffer.from(portrait.content, "base64"), isHost ? expectedHostPortrait : expectedDriverPortrait);
      assert.ok(email.html.includes(`cid:${portrait.content_id}`));
      assert.equal(email.attachments.some(a => a.filename === `parkshare-${isHost ? "parker" : "william"}-portrait.png`), false);
      assert.match(email.html, /Q30/);
      assert.match(email.html, /DEMO 123/);
      assert.match(email.html, /PK-42/);
      assert.ok(email.html.includes(`Spot ${chosenLabel}`), email.subject + " must retain its physical bay label");
      assert.match(email.html, /Europe\/Bucharest local time/);
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
    // Missing recipients must report failure without a sent marker or a
    // provider request, rather than silently incrementing endingSent.
    missingRecipient = true;
    booking.reminder_ending_sent_at = null;
    const beforeFailure = sent.length;
    res = response();
    await reminders({method:"GET",headers:{authorization:"Bearer sample-cron"}},res);
    assert.deepEqual(res.body,{halfwaySent:0,endingSent:0,failed:1});
    assert.equal(sent.length,beforeFailure);
    assert.equal(booking.reminder_ending_sent_at,null);
    } finally {
      stripe.paymentIntents.retrieve = originalRetrieve;
      stripe.charges.retrieve = originalChargeRetrieve;
      stripe.refunds.list = originalRefundList;
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

}
