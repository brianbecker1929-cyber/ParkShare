// POST /api/stripe-webhook
// Configure this endpoint in Stripe to receive BOTH platform events and
// events from connected accounts. Direct-charge events include event.account.

import { stripe, supabaseAdmin, getSessionWindow } from "./_lib.js";
import { isNewWebhookInsert } from "./_booking-rules.js";
import { sendEmail, confirmationEmailHtml, extensionConfirmedHtml } from "./_email.js";
import { renderParkingSpotImage } from "./_driveway-image.js";

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// "Today" if the date is today in the server's local time, otherwise a
// short weekday/month/day label — matches the [SESSION_START_DATE_LABEL]
// example in the confirmation template ("Today" or "Mon, Jan 15").
function dayLabel(date, now) {
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) return "Today";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

async function syncConnectedAccount(account) {
  const requirementsDue = [
    ...(account.requirements?.currently_due || []),
    ...(account.requirements?.past_due || []),
  ];
  const complete = Boolean(account.details_submitted && account.charges_enabled && account.payouts_enabled);

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      stripe_onboarding_complete: complete,
      stripe_charges_enabled: Boolean(account.charges_enabled),
      stripe_payouts_enabled: Boolean(account.payouts_enabled),
      stripe_requirements_due: [...new Set(requirementsDue)],
    })
    .eq("stripe_account_id", account.id);
  if (error) throw error;
}

async function confirmBooking(session, connectedAccountId) {
  if (session.payment_status !== "paid") return;
  const metadata = session.metadata || {};
  const listingId = Number(metadata.listing_id);
  const hours = Number(metadata.hours);
  const totalCents = Number(metadata.total_cents);
  const chargeAccountId = connectedAccountId || metadata.connected_account_id || null;
  if (!Number.isInteger(listingId) || !metadata.renter_id || !Number.isFinite(hours) || !Number.isFinite(totalCents)) {
    throw new Error("Checkout Session is missing required ParkShare metadata.");
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  let chargeId = null;
  if (paymentIntentId && chargeAccountId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: chargeAccountId });
    chargeId = typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id || null;
  }

  const row = {
    listing_id: listingId,
    renter_id: metadata.renter_id,
    hours,
    total: totalCents / 100,
    subtotal: Number(metadata.subtotal_cents || 0) / 100,
    service_fee: Number(metadata.service_fee_cents || 0) / 100,
    status: "confirmed",
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    stripe_charge_id: chargeId,
    stripe_connected_account_id: chargeAccountId,
    spot_label: metadata.spot_label || null,
    booking_date: metadata.booking_date || null,
    start_hour: metadata.start_hour === "" ? null : Number(metadata.start_hour),
    end_hour: metadata.end_hour === "" ? null : Number(metadata.end_hour),
    paid_at: new Date().toISOString(),
  };

  // Upsert makes webhook retries safe. With ignoreDuplicates:true, Postgres
  // does ON CONFLICT DO NOTHING — a retried/duplicate webhook returns no
  // row here, which is exactly how we tell "genuinely new booking" (send
  // the confirmation email) apart from "we already processed this" (don't).
  const { data: inserted, error } = await supabaseAdmin
    .from("bookings")
    .upsert(row, { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true })
    .select("id, listing_id, renter_id, hours, total, spot_label, paid_at, booking_date, start_hour");
  if (error) {
    // A hold should make this exceptionally rare, but a payment can complete
    // at the exact expiry boundary. Never leave that customer charged without
    // a booking: issue an idempotent automatic refund on a database conflict.
    if (error.code === "23P01" && paymentIntentId && chargeAccountId) {
      await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          reason: "requested_by_customer",
          metadata: { parkshare_reason: "booking_conflict", checkout_session_id: session.id },
        },
        { stripeAccount: chargeAccountId, idempotencyKey: `booking-conflict-${session.id}` }
      );
      await supabaseAdmin.from("booking_holds").delete().eq("id", metadata.hold_id || "00000000-0000-0000-0000-000000000000");
      console.error("Automatically refunded conflicting paid checkout", session.id);
      return;
    }
    throw error;
  }

  if (metadata.hold_id) {
    await supabaseAdmin.from("booking_holds").delete().eq("id", metadata.hold_id);
  }

  if (isNewWebhookInsert(inserted)) {
    await sendBookingConfirmationEmail(inserted[0]).catch(err => {
      // Email failure should never fail the webhook / trigger a Stripe retry
      // of the whole event — the booking itself is already confirmed.
      console.error("Failed to send booking confirmation email:", err);
    });
  }
}

// Handles a completed Checkout Session for "Add Additional Time," as
// distinct from confirmBooking() above (a brand-new booking). Routed here
// by metadata.type === "extension" — see create-extend-session.js, which
// is the only thing that ever sets that metadata field.
async function confirmExtension(session, connectedAccountId) {
  if (session.payment_status !== "paid") return;
  const metadata = session.metadata || {};
  const bookingId = Number(metadata.booking_id);
  const addedHours = Number(metadata.added_hours);
  const totalCents = Number(metadata.total_cents);
  if (!Number.isInteger(bookingId) || !Number.isFinite(addedHours) || !Number.isFinite(totalCents)) {
    throw new Error("Extension Checkout Session is missing required ParkShare metadata.");
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  let chargeId = null;
  if (paymentIntentId && connectedAccountId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: connectedAccountId });
    chargeId = typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id || null;
  }

  const row = {
    booking_id: bookingId,
    added_hours: addedHours,
    added_amount: totalCents / 100,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    stripe_charge_id: chargeId,
    stripe_connected_account_id: connectedAccountId || null,
    status: "confirmed",
    paid_at: new Date().toISOString(),
  };

  // Same idempotency pattern as confirmBooking() — upsert keyed on the
  // unique checkout session id, ignoreDuplicates so a Stripe retry of this
  // same event can never apply the same extension twice.
  const { data: inserted, error } = await supabaseAdmin
    .from("booking_extensions")
    .upsert(row, { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true })
    .select("id, booking_id, added_hours");
  if (error) throw error;
  if (!isNewWebhookInsert(inserted)) return; // already processed this exact session before

  // Bump the booking's hours so getSessionWindow() — and everything built
  // on it (reminders, availability, the Phase 3 exclusion constraint) —
  // picks up the new, longer end time with no further changes needed
  // anywhere else. Read-then-write rather than an atomic SQL increment:
  // acceptable here because the only realistic race is the SAME renter
  // submitting two extensions on the SAME booking within milliseconds of
  // each other — low-stakes and unlikely, unlike the cross-renter spot
  // conflict Phase 3 protects against, which is why that one got a real
  // database constraint instead of just application-level care.
  const { data: booking, error: fetchError } = await supabaseAdmin
    .from("bookings")
    .select("hours")
    .eq("id", bookingId)
    .single();
  if (fetchError) throw fetchError;

  const { error: updateError } = await supabaseAdmin
    .from("bookings")
    .update({ hours: Number(booking.hours) + addedHours })
    .eq("id", bookingId);
  if (updateError) throw updateError;

  await sendExtensionConfirmedEmail(bookingId, addedHours, totalCents).catch(err => {
    // Same non-blocking pattern as the original booking confirmation email —
    // the extension itself is already paid for and recorded above; a failed
    // email should never turn into a Stripe retry of the whole webhook.
    console.error("Failed to send extension confirmation email:", err);
  });
}

async function sendExtensionConfirmedEmail(bookingId, addedHours, totalCents) {
  const { data: booking, error: bookingError } = await supabaseAdmin
    .from("bookings")
    .select("id, listing_id, renter_id, hours, spot_label, paid_at, booking_date, start_hour")
    .eq("id", bookingId)
    .single();
  if (bookingError || !booking) throw bookingError || new Error("Booking not found after extension.");

  const { data: listing } = await supabaseAdmin
    .from("listings")
    .select("address, spaces, host_id")
    .eq("id", booking.listing_id)
    .single();
  const { data: renter } = await supabaseAdmin
    .from("profiles")
    .select("name, email")
    .eq("id", booking.renter_id)
    .single();
  if (!renter?.email) return;

  let hostName = "your host";
  if (listing?.host_id) {
    const { data: host } = await supabaseAdmin.from("profiles").select("name").eq("id", listing.host_id).single();
    hostName = host?.name || hostName;
  }

  // booking.hours already reflects this extension (confirmExtension() above
  // updated it before calling this function), so getSessionWindow() here
  // gives the NEW end time directly — no separate "add addedHours" math
  // needed.
  const { end } = getSessionWindow(booking);
  const timeFmt = { hour: "numeric", minute: "2-digit" };
  const fullDateFmt = { weekday: "short", month: "long", day: "numeric", year: "numeric" };

  const addedTimeStr = addedHours === 0.5 ? "30 minutes" : `${addedHours} hour${addedHours === 1 ? "" : "s"}`;
  const amountChargedStr = (totalCents / 100).toLocaleString(undefined, { style: "currency", currency: "CAD" });

  const spaces = listing?.spaces || 1;
  const spotStates = [0, 1, 2, 3].map(i => i < spaces);
  const chosenIndex = booking.spot_label
    ? booking.spot_label.trim().toUpperCase().charCodeAt(0) - 65
    : null;

  let attachments;
  let spotImageCid;
  try {
    const imageBuffer = await renderParkingSpotImage(spotStates, chosenIndex);
    spotImageCid = "parking-spot-ext-" + booking.id;
    attachments = [{
      filename: "parking-spot.png",
      content: imageBuffer.toString("base64"),
      content_id: spotImageCid,
    }];
  } catch (err) {
    console.error("Failed to generate parking spot image for extension email (sending without it):", err);
  }

  const address = listing?.address || "";

  await sendEmail({
    to: renter.email,
    subject: `Extension confirmed — +${addedTimeStr} added`,
    html: extensionConfirmedHtml({
      renterName: renter.name || "there",
      hostName,
      address,
      locationId: booking.listing_id,
      spotLabel: booking.spot_label,
      addedTime: addedTimeStr,
      amountCharged: amountChargedStr,
      newEndTime: end.toLocaleTimeString(undefined, timeFmt),
      newEndDateFull: end.toLocaleDateString(undefined, fullDateFmt),
      spotImageCid,
      directionsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
      manageReservationUrl: `https://www.myparkshare.ca/?view_booking=${booking.id}`,
      extendUrl: `https://www.myparkshare.ca/?extend_booking=${booking.id}`,
      supportEmail: process.env.SUPPORT_EMAIL || "support@myparkshare.ca",
      supportPhone: process.env.SUPPORT_PHONE || "(555) 123-4567",
    }),
    attachments,
  });
}

async function sendBookingConfirmationEmail(booking) {
  const { data: listing } = await supabaseAdmin
    .from("listings")
    .select("title, address, spaces, host_id")
    .eq("id", booking.listing_id)
    .single();
  const { data: renter } = await supabaseAdmin
    .from("profiles")
    .select("name, email")
    .eq("id", booking.renter_id)
    .single();
  if (!renter?.email) return;

  let hostName = "your host";
  if (listing?.host_id) {
    const { data: host } = await supabaseAdmin.from("profiles").select("name").eq("id", listing.host_id).single();
    hostName = host?.name || hostName;
  }

  const { start, end, isAdvance } = getSessionWindow(booking);
  const now = new Date();
  const timeFmt = { hour: "numeric", minute: "2-digit" };
  const fullDateFmt = { weekday: "short", month: "long", day: "numeric", year: "numeric" };

  // NOTE: the new confirmation template has no price/payment summary and no
  // "booked in advance" vs. "already started" copy distinction — both of
  // which the previous design showed. isAdvance is still used below for the
  // email SUBJECT line only. If you want price shown in the email body,
  // that requires adding a placeholder to parking_confirmation.html — ask
  // for that change explicitly rather than having it silently reappear here.
  const spaces = listing?.spaces || 1;
  const spotStates = [0, 1, 2, 3].map(i => i < spaces);
  const chosenIndex = booking.spot_label
    ? booking.spot_label.trim().toUpperCase().charCodeAt(0) - 65
    : null;

  let attachments;
  let spotImageCid;
  try {
    const imageBuffer = await renderParkingSpotImage(spotStates, chosenIndex);
    spotImageCid = "parking-spot-" + booking.id;
    attachments = [{
      filename: "parking-spot.png",
      content: imageBuffer.toString("base64"),
      content_id: spotImageCid,
    }];
  } catch (err) {
    console.error("Failed to generate parking spot image (sending confirmation without it):", err);
  }

  const address = listing?.address || "";

  await sendEmail({
    to: renter.email,
    subject: isAdvance ? "Booking confirmed — " + (listing?.title || "ParkShare") : "Parking authorized — " + (listing?.title || "ParkShare"),
    html: confirmationEmailHtml({
      renterName: renter.name || "there",
      hostName,
      address,
      locationId: booking.listing_id,
      spotLabel: booking.spot_label,
      confirmationNumber: "PK-" + booking.id,
      startDateLabel: dayLabel(start, now),
      startTimeStr: start.toLocaleTimeString(undefined, timeFmt),
      entryDateFull: start.toLocaleDateString(undefined, fullDateFmt),
      endTimeStr: end.toLocaleTimeString(undefined, timeFmt),
      exitDateFull: end.toLocaleDateString(undefined, fullDateFmt),
      spotImageCid,
      directionsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
      // TODO: confirm this route actually exists in your app — this is a
      // guess based on common patterns, not read from your frontend router.
      manageReservationUrl: `https://www.myparkshare.ca/?view_booking=${booking.id}`,
      supportEmail: process.env.SUPPORT_EMAIL || "support@myparkshare.ca",
      supportPhone: process.env.SUPPORT_PHONE || "(555) 123-4567",
    }),
    attachments,
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method not allowed");
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error("Webhook signature verification failed:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        if (session.metadata?.type === "extension") {
          await confirmExtension(session, event.account || null);
        } else {
          await confirmBooking(session, event.account || null);
        }
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object;
        if (session.metadata?.type === "extension") {
          // Nothing to roll back — confirmExtension() never ran, so
          // bookings.hours was never touched. Just mark the row so it
          // doesn't sit as "pending" forever.
          await supabaseAdmin
            .from("booking_extensions")
            .update({ status: "payment_failed" })
            .eq("stripe_checkout_session_id", session.id);
        } else {
          await supabaseAdmin
            .from("bookings")
            .update({ status: "payment_failed" })
            .eq("stripe_checkout_session_id", session.id);
          if (session.metadata?.hold_id) {
            await supabaseAdmin.from("booking_holds").delete().eq("id", session.metadata.hold_id);
          }
        }
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object;
        if (session.metadata?.hold_id) {
          await supabaseAdmin.from("booking_holds").delete().eq("id", session.metadata.hold_id);
        }
        break;
      }

      case "account.updated":
        await syncConnectedAccount(event.data.object);
        break;

      // KNOWN GAP: refunds/disputes below only check the `bookings` table.
      // An extension's charge has its own separate payment_intent/charge id
      // (see confirmExtension() above), so a refund issued against just the
      // extension portion currently matches nothing here and silently
      // no-ops. Deliberately left unhandled rather than guessing at the
      // right behavior (e.g. should refunding an extension also decrement
      // bookings.hours back down? what if it's been extended again since?)
      // — worth its own explicit decision rather than bundling into this
      // fix. Ask for it directly if refunding extensions needs to work.
      case "charge.refunded": {
        const charge = event.data.object;
        const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (paymentIntentId) {
          await supabaseAdmin
            .from("bookings")
            .update({ status: charge.refunded ? "refunded" : "partially_refunded" })
            .eq("stripe_payment_intent_id", paymentIntentId);
        }
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object;
        const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
        if (chargeId) {
          await supabaseAdmin
            .from("bookings")
            .update({ status: "disputed" })
            .eq("stripe_charge_id", chargeId);
        }
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error(`Webhook handler failed for ${event.type}:`, error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}
