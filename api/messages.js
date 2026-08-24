// Authenticated booking-aware messaging endpoint.
// Keeping participant checks server-side prevents a listing-wide conversation
// from leaking between unrelated renters and surfaces insert errors to the UI.

import { jsonMethod, requireUser, supabaseAdmin } from "./_lib.js";

async function listingFor(id) {
  const { data, error } = await supabaseAdmin
    .from("listings")
    .select("id, host_id, title, profiles(name)")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Listing not found.");
  return data;
}

async function bookingFor(id) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("id, listing_id, renter_id")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Booking not found.");
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    if (req.method === "POST") {
      const listingId = Number(req.body?.listingId);
      const bookingId = req.body?.bookingId ? Number(req.body.bookingId) : null;
      const participantId = req.body?.participantId ? String(req.body.participantId) : null;
      const messageText = String(req.body?.text || "").trim().slice(0, 4000);
      if (!Number.isInteger(listingId) || !messageText) {
        return res.status(400).json({ error: "A listing and message are required." });
      }

      const listing = await listingFor(listingId);
      let recipientId;
      if (bookingId) {
        const booking = await bookingFor(bookingId);
        if (booking.listing_id !== listingId || (user.id !== booking.renter_id && user.id !== listing.host_id)) {
          return res.status(403).json({ error: "You are not part of this booking conversation." });
        }
        recipientId = user.id === listing.host_id ? booking.renter_id : listing.host_id;
      } else if (user.id === listing.host_id) {
        if (!participantId || participantId === user.id) {
          return res.status(400).json({ error: "Choose a renter conversation before replying." });
        }
        recipientId = participantId;
      } else {
        recipientId = listing.host_id;
      }

      const { data, error } = await supabaseAdmin
        .from("messages")
        .insert({ listing_id: listingId, booking_id: bookingId, sender_id: user.id, recipient_id: recipientId, text: messageText })
        .select("id, listing_id, booking_id, sender_id, recipient_id, text, created_at")
        .single();
      if (error) throw error;
      return res.status(201).json({ message: data });
    }

    const listingId = req.query?.listingId ? Number(req.query.listingId) : null;
    const bookingId = req.query?.bookingId ? Number(req.query.bookingId) : null;
    const participantId = req.query?.participantId ? String(req.query.participantId) : null;
    let query = supabaseAdmin
      .from("messages")
      .select("id, listing_id, booking_id, sender_id, recipient_id, text, created_at")
      .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
      .order("created_at", { ascending: true });
    if (Number.isInteger(listingId)) query = query.eq("listing_id", listingId);
    if (Number.isInteger(bookingId)) query = query.eq("booking_id", bookingId);
    const { data, error } = await query;
    if (error) throw error;

    let rows = data || [];
    if (participantId) rows = rows.filter(r => r.sender_id === participantId || r.recipient_id === participantId);
    if (Number.isInteger(listingId)) return res.status(200).json({ messages: rows });

    const latest = new Map();
    for (const row of rows) {
      const otherId = row.sender_id === user.id ? row.recipient_id : row.sender_id;
      const key = `${row.listing_id}:${row.booking_id || "listing"}:${otherId}`;
      latest.set(key, { row, otherId });
    }
    const conversations = [];
    for (const { row, otherId } of latest.values()) {
      const [listingResult, profileResult] = await Promise.all([
        supabaseAdmin.from("listings").select("id, title, host_id").eq("id", row.listing_id).single(),
        supabaseAdmin.from("profiles").select("id, name").eq("id", otherId).single(),
      ]);
      conversations.push({
        id: `${row.listing_id}-${row.booking_id || "listing"}-${otherId}`,
        listingId: row.listing_id,
        bookingId: row.booking_id,
        participantId: otherId,
        title: listingResult.data?.title || "Listing",
        otherParty: profileResult.data?.name || (listingResult.data?.host_id === otherId ? "Host" : "Renter"),
        preview: row.text,
        createdAt: row.created_at,
      });
    }
    conversations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.status(200).json({ conversations });
  } catch (error) {
    console.error("messages API error:", error);
    const status = /not found/i.test(error.message || "") ? 404 : 500;
    return res.status(status).json({ error: error.message || "Unable to load messages." });
  }
}
