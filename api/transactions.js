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

export default async function handler(req, res) {
  if (!jsonMethod(req, res, "GET")) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const [spent, earned, payouts] = await Promise.all([
      getSpentTransactions(user.id),
      getEarnedTransactions(user.id),
      getPayouts(user.id),
    ]);

    return res.status(200).json({ spent, earned, payouts });
  } catch (error) {
    console.error("transactions error:", error);
    return res.status(500).json({ error: error.message || "Unable to load transactions." });
  }
}

// ---------------------------------------------------------------------
// Money the user has SPENT — their own bookings + extensions on those
// bookings, regardless of who hosts the listing.
// ---------------------------------------------------------------------
async function getSpentTransactions(userId) {
  const { data: bookings, error } = await supabaseAdmin
    .from("bookings")
    .select("id, listing_id, hours, total, subtotal, service_fee, status, paid_at, spot_label, listings(title, address)")
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
    rows.push({
      type: "booking",
      id: `booking-${b.id}`,
      bookingId: b.id,
      description: b.listings?.title || "Parking session",
      address: b.listings?.address || "",
      amount: Number(b.total || 0),
      status: b.status,
      date: b.paid_at,
      spotLabel: b.spot_label,
    });
  }
  for (const ext of extensions) {
    rows.push({
      type: "extension",
      id: `extension-${ext.id}`,
      bookingId: ext.booking_id,
      description: "Added time",
      amount: Number(ext.added_amount || 0),
      status: ext.status,
      date: ext.paid_at,
    });
  }

  rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  return rows;
}

// ---------------------------------------------------------------------
// Money the user has EARNED — bookings + extensions on listings they host.
// Shows the gross amount, the platform fee taken, and the net (what
// actually gets paid out) separately, since bookings already stores
// subtotal/service_fee as real numbers — no need to estimate anything.
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
    .select("id, listing_id, total, subtotal, service_fee, status, paid_at, spot_label")
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
    // subtotal/service_fee are the same numbers already computed at
    // checkout (create-checkout-session.js) — the host's net is just
    // subtotal, since service_fee is ParkShare's cut, not theirs.
    rows.push({
      type: "booking",
      id: `booking-${b.id}`,
      bookingId: b.id,
      description: listing?.title || "Parking session",
      address: listing?.address || "",
      gross: Number(b.total || 0),
      platformFee: Number(b.service_fee || 0),
      net: Number(b.subtotal || 0),
      status: b.status,
      date: b.paid_at,
      spotLabel: b.spot_label,
    });
  }
  for (const ext of extensions) {
    const parentBooking = bookingById[ext.booking_id];
    const listing = parentBooking ? listingById[parentBooking.listing_id] : null;
    // Extensions don't split out a service fee the way the original
    // booking does (create-extend-session.js charges the same 15% but
    // doesn't persist subtotal/service_fee separately on the extension
    // row) — approximate the split here at the same known rate rather
    // than leaving it blank. Flagged as an approximation, not stored fact.
    const grossCents = Math.round(Number(ext.added_amount || 0) * 100);
    const feeCents = Math.round(grossCents * (0.15 / 1.15)); // back out the fee from a total that already includes it
    rows.push({
      type: "extension",
      id: `extension-${ext.id}`,
      bookingId: ext.booking_id,
      description: (listing?.title || "Parking session") + " — added time",
      address: listing?.address || "",
      gross: Number(ext.added_amount || 0),
      platformFee: feeCents / 100,
      net: (grossCents - feeCents) / 100,
      status: ext.status,
      date: ext.paid_at,
      approximateFeeSplit: true,
    });
  }

  rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  return rows;
}

async function fetchExtensionsForBookings(bookingIds) {
  const { data, error } = await supabaseAdmin
    .from("booking_extensions")
    .select("id, booking_id, added_hours, added_amount, status, paid_at")
    .in("booking_id", bookingIds)
    .not("paid_at", "is", null);
  // Older deployments may not have applied the extensions migration yet.
  // Original booking history must remain usable while that migration lands.
  if (error) {
    if (error.code === "PGRST205" || /booking_extensions/i.test(error.message || "")) return [];
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
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", userId)
    .single();

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
