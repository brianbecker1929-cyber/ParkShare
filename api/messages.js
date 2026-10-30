// Authenticated booking-aware messaging endpoint.
// Keeping participant checks server-side prevents a listing-wide conversation
// from leaking between unrelated renters and surfaces insert errors to the UI.

import { requireUser, supabaseAdmin } from "./_lib.js";
import { canReadPreciseLocation, validId } from "../src/lib/privateListingAccess.js";

const validParticipant = value => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

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
    .select("id, listing_id, renter_id, status, paid_at, stripe_checkout_session_id")
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

    if (req.method === "GET" && req.query?.contextBookingId !== undefined) {
      const value = String(req.query.contextBookingId);
      const bookingId = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(bookingId) || bookingId <= 0) {
        return res.status(400).json({ error: "A valid booking is required." });
      }
      const booking = await bookingFor(bookingId);
      const { data: listing, error } = await supabaseAdmin.from("listings")
        .select("id, host_id, title, address, price, spaces, features, description, img, photos, lat, lng, spots, availability")
        .eq("id", booking.listing_id).single();
      if (error || !listing) return res.status(404).json({ error: "Listing not found." });
      // Even a once-created but unpaid/cancelled booking must not expose
      // the property's exact address via messaging context.
      if (!canReadPreciseLocation({
        userId: user.id, hostId: listing.host_id,
        booking, listingId: listing.id,
      })) {
        return res.status(404).json({ error: "Booking details unavailable." });
      }
      const isHost = user.id === listing.host_id;
      const recipientId = isHost ? booking.renter_id : listing.host_id;
      const { data: people, error: profileError } = await supabaseAdmin.from("profiles")
        .select("id, name").in("id", [listing.host_id, booking.renter_id]);
      if (profileError) throw profileError;
      const recipient = (people || []).find(person => person.id === recipientId);
      return res.status(200).json({
        bookingId, listing,
        hostName: (people || []).find(person => person.id === listing.host_id)?.name || "Host",
        recipient: { id: recipientId, name: recipient?.name || (isHost ? "Driver" : "Host"), role: isHost ? "Driver" : "Host" },
      });
    }

    if (req.method === "POST") {
      const listingId = validId(req.body?.listingId);
      const bookingId = req.body?.bookingId == null ? null : validId(req.body.bookingId);
      const participantId = req.body?.participantId ? String(req.body.participantId) : null;
      const messageText = String(req.body?.text || "").trim().slice(0, 4000);
      if (!listingId || (req.body?.bookingId != null && !bookingId) || !messageText) {
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
        if (!validParticipant(participantId) || participantId === user.id) {
          return res.status(400).json({ error: "Choose an existing Driver conversation before replying." });
        }
        const { data: conversation, error: participantError } = await supabaseAdmin
          .from("messages")
          .select("id")
          .eq("listing_id", listingId)
          .eq("sender_id", participantId)
          .eq("recipient_id", user.id)
          .limit(1);
        if (participantError) throw participantError;
        if (!conversation?.length) {
          return res.status(403).json({ error: "You can reply only to a Driver who contacted you about this listing." });
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

    const listingId = req.query?.listingId == null ? null : validId(req.query.listingId);
    const bookingId = req.query?.bookingId == null ? null : validId(req.query.bookingId);
    const participantId = req.query?.participantId ? String(req.query.participantId) : null;
    if ((req.query?.listingId != null && !listingId)
      || (req.query?.bookingId != null && !bookingId)
      || (participantId && !validParticipant(participantId))) {
      return res.status(400).json({ error: "Invalid conversation." });
    }
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
      const [listingResult, profileResult, booking] = await Promise.all([
        supabaseAdmin.from("listings").select("id, title, host_id").eq("id", row.listing_id).single(),
        supabaseAdmin.from("profiles").select("id, name").eq("id", otherId).single(),
        row.booking_id ? bookingFor(row.booking_id) : null,
      ]);
      if (listingResult.error || profileResult.error) throw listingResult.error || profileResult.error;
      const mayReadTitle = canReadPreciseLocation({
        userId: user.id, hostId: listingResult.data?.host_id,
        listingId: row.listing_id, booking,
      });
      // Roles belong to this listing relationship, not a profile's global role.
      const partyRole = listingResult.data?.host_id === otherId ? "Host"
        : listingResult.data?.host_id === user.id ? "Driver" : "ParkShare user";
      conversations.push({
        id: `${row.listing_id}-${row.booking_id || "listing"}-${otherId}`,
        listingId: row.listing_id,
        bookingId: row.booking_id,
        participantId: otherId,
        title: mayReadTitle ? listingResult.data?.title || "Listing" : "Private parking",
        otherParty: profileResult.data?.name || partyRole,
        partyRole,
        preview: row.text,
        createdAt: row.created_at,
      });
    }
    conversations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.status(200).json({ conversations });
  } catch (error) {
    console.error("messages API error:", { code: error?.code });
    const status = /not found/i.test(error.message || "") ? 404 : 500;
    return res.status(status).json({ error: status === 404 ? "Conversation unavailable." : "Unable to load or send messages right now." });
  }
}

