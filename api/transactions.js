// GET /api/transactions
// Requires Authorization: Bearer <supabase access token>, same as
// create-extend-session.js.
//
// Returns everything needed to power a Transactions page, in one call:
//   - spent:   bookings + extensions where the current user is the renter
//   - earned:  bookings + extensions on listings the current user hosts
//   - payouts: real Stripe payout history for the current user's connected
//              account (only present if they have one) — this data doesn't
//              exist anywhere in Supabase; it's fetched live from Stripe.
//
// Deliberately NOT gated by profiles.role — that field is just a UI/tab
// label (see App.jsx), and doesn't reflect what data a user actually has.
// A "driver"-labeled user with a listing still has real earned/payout
// data, and this returns whatever's actually there for their user id
// rather than trusting the role flag.
//
// Uses supabaseAdmin (service-role key) rather than a client-side RLS-gated
// query, matching every other cross-table/cross-user read in this codebase
// (stripe-webhook.js, send-reminders.js, create-extend-session.js) — this
// endpoint IS the access-control boundary, same as those.

import { jsonMethod, requireUser, stripe, supabaseAdmin } from "./_lib.js";
import { hostEarningsForRecord, mapHostEarnings } from "./_host-earnings.js";
import { loadTransactionHistory } from "./_transaction-history.js";
import { canReadPreciseLocation } from "../src/lib/privateListingAccess.js";

export default async function handler(req, res) {
  if (!jsonMethod(req, res, "GET")) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const result = await loadTransactionHistory({
      loadSpent: () => getSpentTransactions(user.id),
      loadEarned: () => getEarnedTransactions(user.id),
      loadPayouts: () => getPayouts(user.id),
      onPayoutError: error => console.warn("[transactions] payouts unavailable", { code: error?.code || "unavailable" }),
    });
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json(result);
  } catch (error) {
    console.error("transactions error:", { code: error?.code });
    return res.status(500).json({ error: "Unable to load transactions right now." });
  }
}

// ---------------------------------------------------------------------
// Money the user has SPENT — their own bookings + extensions on those
// bookings, regardless of who hosts the listing.
// ---------------------------------------------------------------------
function spendingRefundAmounts(row) {
  if (row.refund_total_amount == null) return {};
  return { refundedAmount: Number(row.refund_total_amount), refundPendingAmount: Number(row.refund_pending_amount || 0) };
}
function spendingRefundStatus(row, gross) {
  if (row.status === "disputed" || row.charge_disputed) return "disputed";
  if (row.refund_total_amount == null) return row.status;
  if (Number(row.refund_total_amount) >= Number(gross)) return "refunded";
  if (Number(row.refund_pending_amount) > 0) return "refund_pending";
  if (Number(row.refund_total_amount) > 0) return "partially_refunded";
  return row.status;
}

async function getSpentTransactions(userId) {
  const { data: bookings, error } = await supabaseAdmin
    .from("bookings")
    .select("id, listing_id, renter_id, hours, total, subtotal, service_fee, application_state, status, paid_at, spot_label, refund_total_amount, refund_pending_amount, stripe_checkout_session_id, listings(host_id, title, address)")
    .eq("renter_id", userId)
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: false });
  if (error) throw error;

  const bookingIds = (bookings || []).map(b => b.id);
  const extensions = bookingIds.length
    ? await fetchExtensionsForBookings(bookingIds)
    : [];

  const rows = [];
  for (const b of bookings || []) {
    const precise = canReadPreciseLocation({ userId, hostId: b.listings?.host_id, listingId: b.listing_id, booking: b });
    rows.push({
      type: "booking",
      id: `booking-${b.id}`,
      bookingId: b.id,
      description: b.application_state === "rejected" ? "Booking not confirmed" : precise ? b.listings?.title || "Parking session" : "Parking session",
      address: precise ? b.listings?.address || "" : "",
      amount: Number(b.total || 0),
      status: spendingRefundStatus(b, b.total),
      ...spendingRefundAmounts(b),
      date: b.paid_at,
      spotLabel: b.spot_label,
    });
  }
  for (const ext of extensions) {
    rows.push({
      type: "extension",
      id: `extension-${ext.id}`,
      bookingId: ext.booking_id,
      description: ext.application_state === "rejected" ? "Extension not applied" : "Added time",
      amount: Number(ext.added_amount || 0),
      status: spendingRefundStatus(ext, ext.added_amount),
      ...spendingRefundAmounts(ext),
      date: ext.paid_at,
    });
  }

  rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  return rows;
}

// ---------------------------------------------------------------------
// Money the user has EARNED — bookings + extensions on listings they host.
// Show remaining booking proceeds before Stripe processing fees, separately
// from actual payouts. Refund records are verified with read-only Stripe calls.
// ---------------------------------------------------------------------
async function getEarnedTransactions(userId) {
  const { data: listings, error: listingsError } = await supabaseAdmin
    .from("listings")
    .select("id, title, address")
    .eq("host_id", userId);
  if (listingsError) throw listingsError;
  if (!listings || listings.length === 0) return [];

  const listingIds = listings.map(l => l.id);
  const listingById = Object.fromEntries(listings.map(l => [l.id, l]));

  const { data: bookings, error } = await supabaseAdmin
    .from("bookings")
    .select("id, listing_id, total, subtotal, service_fee, application_state, status, paid_at, spot_label, stripe_payment_intent_id, stripe_charge_id, stripe_connected_account_id, stripe_refund_id, refund_status, refund_amount, refund_total_amount, refund_pending_amount")
    .in("listing_id", listingIds)
    .not("paid_at", "is", null)
    .order("paid_at", { ascending: false });
  if (error) throw error;

  const bookingIds = (bookings || []).map(b => b.id);
  const extensions = bookingIds.length
    ? await fetchExtensionsForBookings(bookingIds)
    : [];
  const bookingById = Object.fromEntries((bookings || []).map(b => [b.id, b]));

  const rows = [];
  for (const b of bookings || []) {
    const listing = listingById[b.listing_id];
    rows.push({
      source: b,
      isExtension: false,
      transaction: {
        type: "booking",
        id: `booking-${b.id}`,
        bookingId: b.id,
        description: b.application_state === "rejected" ? "Booking not confirmed" : listing?.title || "Parking session",
        address: listing?.address || "",
        gross: Number(b.total || 0),
        status: b.status,
        date: b.paid_at,
        spotLabel: b.spot_label,
      },
    });
  }
  for (const ext of extensions) {
    const parentBooking = bookingById[ext.booking_id];
    const listing = parentBooking ? listingById[parentBooking.listing_id] : null;
    rows.push({
      source: ext,
      isExtension: true,
      transaction: {
        type: "extension",
        id: `extension-${ext.id}`,
        bookingId: ext.booking_id,
        description: (listing?.title || "Parking session") + (ext.application_state === "rejected" ? " — extension not applied" : " — added time"),
        address: listing?.address || "",
        gross: Number(ext.added_amount || 0),
        status: ext.status,
        date: ext.paid_at,
      },
    });
  }

  // Bound external work; any records not verified within the shared budget
  // remain visible under review, rather than timing out the entire history.
  const deadlineAt = Date.now() + 15_000;
  const reconciled = await mapHostEarnings(rows, async ({ source, isExtension, transaction }) => ({
    ...transaction,
    ...await hostEarningsForRecord(stripe, source, { isExtension, deadlineAt }),
  }));
  reconciled.sort((a, b) => new Date(b.date) - new Date(a.date));
  return reconciled;
}

async function fetchExtensionsForBookings(bookingIds) {
  const { data, error } = await supabaseAdmin
    .from("booking_extensions")
    .select("id, booking_id, added_hours, added_amount, application_state, status, paid_at, stripe_payment_intent_id, stripe_charge_id, stripe_connected_account_id, stripe_refund_id, refund_status, refund_amount, charge_amount_refunded, charge_fully_refunded, charge_disputed, refund_total_amount, refund_pending_amount")
    .in("booking_id", bookingIds)
    .not("paid_at", "is", null);
  // Older deployments may not have applied the extensions migration yet.
  // Original booking history must remain usable while that migration lands.
  if (error) {
    if (["PGRST205", "42P01"].includes(error.code) && /booking_extensions/i.test(error.message || "")) return [];
    throw error;
  }
  return data || [];
}

// ---------------------------------------------------------------------
// Real Stripe payout history — this is NOT in Supabase anywhere. Stripe
// manages payout scheduling for connected accounts on its own; the only
// way to know what's actually been paid out (or is pending) is to ask
// Stripe directly.
// ---------------------------------------------------------------------
async function getPayouts(userId) {
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", userId)
    .single();
  if (error) throw error;

  const stripeAccountId = profile?.stripe_account_id;
  if (!stripeAccountId) return []; // not a host, or hasn't connected Stripe yet

  const list = await stripe.payouts.list({ limit: 25 }, { stripeAccount: stripeAccountId });
  return list.data.map(p => ({
    id: p.id,
    amount: p.amount / 100,
    currency: p.currency,
    status: p.status, // "paid" | "pending" | "in_transit" | "failed" | "canceled"
    arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
    created: new Date(p.created * 1000).toISOString(),
  }));
}
