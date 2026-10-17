#!/usr/bin/env node
// Read-only reconciliation of connected-account Stripe Checkout events and
// ParkShare booking rows. This is an operator CLI, NOT a serverless endpoint.
// No replay, refund, inserts, updates, deletes, emails, or secrets printed.
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { reconcilePaidCheckout } from "../src/lib/stripeReconciliation.js";

const PROJECT_REFS = Object.freeze({
  prod: "oyxrussraxjgqwzpwyca",
  qa: "biydlfekindgaslgktsx",
});
const MAX_EVENTS = 2000;
const argumentsMap = Object.fromEntries(process.argv.slice(2).map(part => {
  const match = /^--([a-z-]+)=(.*)$/.exec(part);
  if (!match) throw new Error("Expected --key=value options. See docs/stripe-payment-reconciliation.md");
  return [match[1], match[2]];
}));
const day = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
function validateOptions(options, environment = process.env) {
  const db = options.db;
  const mode = options["stripe-mode"];
  if (!Object.hasOwn(PROJECT_REFS, db) || !["test", "live"].includes(mode)
    || !day(options.from) || !day(options.to) || options.from >= options.to) {
    throw new Error("Required: --db=prod|qa --stripe-mode=test|live --from=YYYY-MM-DD --to=YYYY-MM-DD (end exclusive, UTC)");
  }
  const from = Math.floor(Date.parse(options.from + "T00:00:00Z") / 1000);
  const to = Math.floor(Date.parse(options.to + "T00:00:00Z") / 1000);
  if (to - from > 14 * 86400) throw new Error("Limit each report to a 14-day UTC interval.");
  if (to > Math.floor(Date.now() / 1000) + 86400) throw new Error("End date is in the future.");

  const dbUrl = environment.SUPABASE_URL;
  const dbKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = environment.STRIPE_SECRET_KEY;
  if (!dbUrl || !dbKey || !stripeKey) {
    throw new Error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and STRIPE_SECRET_KEY securely in the operator environment.");
  }
  const expectedOrigin = "https://" + PROJECT_REFS[db] + ".supabase.co";
  let origin;
  try { origin = new URL(dbUrl).origin; } catch { throw new Error("Invalid SUPABASE_URL."); }
  if (origin !== expectedOrigin || dbUrl.replace(/\/$/, "") !== expectedOrigin) {
    throw new Error("Database URL does not match --db selection. Refusing cross-environment audit.");
  }
  if (!new RegExp("^(?:sk|rk)_" + mode + "_").test(stripeKey)) {
    throw new Error("Stripe key mode does not match --stripe-mode. Refusing mixed test/live audit.");
  }
  return { db, mode, from, to, expectedOrigin };
}

async function allRows(client, table, columns) {
  const rows = [];
  for (let first = 0; ; first += 1000) {
    const { data, error } = await client.from(table).select(columns).order("id").range(first, first + 999);
    if (error) throw new Error("Cannot read " + table + " rows (code: " + (error.code || "unknown") + "). Report incomplete.");
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
    if (rows.length >= 50000) throw new Error("Database audit size limit reached; report incomplete.");
  }
  return rows;
}

async function stripeEvents(stripe, { from, to }) {
  const entries = [];
  let after;
  for (;;) {
    const page = await stripe.events.list({
      types: ["checkout.session.completed", "checkout.session.async_payment_succeeded"],
      created: { gte: from, lt: to },
      limit: 100,
      ...(after ? { starting_after: after } : {}),
    });
    entries.push(...page.data);
    if (!page.has_more) return entries;
    if (entries.length >= MAX_EVENTS || !page.data.length) {
      throw new Error("Stripe event limit/pagination reached. Report incomplete, shorten date window.");
    }
    after = page.data.at(-1).id;
  }
}

async function main() {
  const options = validateOptions(argumentsMap);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const [bookings, extensions, listings, profiles] = await Promise.all([
    allRows(supabase, "bookings", "id,stripe_checkout_session_id,stripe_connected_account_id,stripe_payment_intent_id,listing_id,renter_id,total,status"),
    allRows(supabase, "booking_extensions", "id,stripe_checkout_session_id,stripe_connected_account_id,booking_id,added_amount,status"),
    allRows(supabase, "listings", "id"),
    allRows(supabase, "profiles", "id"),
  ]);
  const bookingsBySession = new Map(bookings.filter(x => x.stripe_checkout_session_id).map(x => [x.stripe_checkout_session_id, x]));
  const extensionsBySession = new Map(extensions.filter(x => x.stripe_checkout_session_id).map(x => [x.stripe_checkout_session_id, x]));
  const listingIds = new Set(listings.map(x => Number(x.id)));
  const profileIds = new Set(profiles.map(x => x.id));

  // Platform event stream can include connected-account events (event.account).
  // Audit does NOT assert complete coverage of connected accounts not present
  // in this event stream; check Stripe event destinations and delivery history.
  const events = await stripeEvents(stripe, options);
  const relevant = new Map();
  let filteredMode = 0, notPaid = 0;
  for (const event of events) {
    if (event.livemode !== (options.mode === "live")) { filteredMode += 1; continue; }
    const session = event?.data?.object;
    if (!session?.id || session.payment_status !== "paid") { notPaid += 1; continue; }
    const key = (event.account || "platform") + ":" + session.id;
    // Retain one event per checkout; Stripe can emit both paid event types.
    if (!relevant.has(key)) relevant.set(key, { event, session });
  }

  const counts = {};
  const attention = [];
  for (const { event, session } of relevant.values()) {
    const outcome = reconcilePaidCheckout({
      session,
      eventAccount: event.account || null,
      eventLivemode: event.livemode,
      booking: bookingsBySession.get(session.id),
      extension: extensionsBySession.get(session.id),
      listingIds, profileIds,
      expectedLivemode: options.mode === "live",
    });
    counts[outcome.status] = (counts[outcome.status] || 0) + 1;
    if (outcome.severity !== "ok") {
      attention.push({
        event_id: event.id,
        checkout_session_id: session.id,
        connected_account_id: event.account || null,
        status: outcome.status,
        severity: outcome.severity,
        ...(outcome.missingListing === undefined ? {} : {
          missing_listing: outcome.missingListing,
          missing_driver_profile: outcome.missingRenter,
        }),
      });
    }
  }

  const report = {
    kind: "READ_ONLY_STRIPE_AUDIT",
    scope: {
      database: options.db,
      stripe_mode: options.mode,
      period_utc_start: argumentsMap.from,
      period_utc_end_exclusive: argumentsMap.to,
    },
    stripe_events_scanned: events.length,
    unique_paid_sessions_from_event_stream: relevant.size,
    skipped_unpaid: notPaid,
    excluded_wrong_mode: filteredMode,
    status_counts: counts,
    attention,
    caveats: [
      "This checks events visible to the platform API only, over the selected dates.",
      "Stripe event history is time limited. Verify the event destination received connected-account events and compare its delivery logs.",
      "This audit does not reconstruct historical deleted profile/listing references or issue refunds.",
      "No finding of paid sessions is not proof that all charges/payouts are reconciled.",
    ],
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (attention.some(item => item.severity === "critical")) process.exitCode = 2;
}
main().catch(error => {
  // Avoid echoing provider responses, customer data or credentials in CI logs.
  process.stderr.write("Stripe reconciliation not completed: " +
    (/^(Expected |Required:|Limit |End date |Set |Invalid |Database URL |Stripe key mode |Cannot read |Database audit |Stripe event limit)/.test(error.message)
      ? error.message : "Provider access or query failed; check permissions and console privately.") + "\n");
  process.exitCode = 1;
});
