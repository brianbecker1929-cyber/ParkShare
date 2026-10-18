// POST /api/stripe-webhook
// Configure this endpoint in Stripe to receive BOTH platform events and
// events from connected accounts. Direct-charge events include event.account.

import { stripe, supabaseAdmin, getSessionWindow } from "./_lib.js";
import { isNewWebhookInsert } from "./_booking-rules.js";
import { disputeReconciliation, refundEventReconciliation, refundReconciliation } from "./_refund-rules.js";
import { extensionChargeRefundSnapshot } from "./_extension-safety.js";
import { paymentReconciliationTarget, applyAccountScopedBookingReconciliation, refundRecordPolicy } from "./_refund-dispute-account-safety.js";
import { CheckoutIntegrityError, verifyPaidCheckout, verifyBookingHoldSnapshot } from "./_checkout-integrity.js";
import { retryTransientSupabaseRead, isMissingSupabaseRow } from "./_webhook-db-retry.js";
import { isExpectedCheckoutTermination, matchesRegisteredCheckoutAccount, canFailUnpaidBooking } from "./_checkout-terminal-safety.js";
import { PaidCheckoutReferenceError, requirePaidCheckoutReference, translatePaidBookingInsertError, paidCheckoutReferenceLog } from "./_paid-checkout-reference.js";
import { sendEmail, confirmationEmailHtml, hostBookingNotificationHtml, extensionConfirmedHtml } from "./_email.js";
import { renderParkingSpotImage, deriveEmailSpotStates } from "./_driveway-image.js";
import { renderHostLogoPng, renderHostPortraitPng, renderDriverPortraitPng } from "./_host-logo.js";
import { formatBookingEmailTimes } from "./_booking-email-times.js";

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

async function hostAccountForListing(listingId) {
  const { data: listing, error: listingError } = await readCheckoutDb(
    () => supabaseAdmin.from("listings")
      .select("id, host_id").eq("id", listingId).single(),
    "listing_lookup"
  );
  // CRITICAL: a 522/504/PostgREST outage is NOT a payment-integrity
  // failure and must never be converted into an automatic Stripe refund.
  if (listingError && !isMissingSupabaseRow(listingError)) throw listingError;
  const registeredListing = requirePaidCheckoutReference({ data: listing, error: listingError }, "listing_lookup");
  const { data: host, error: hostError } = await readCheckoutDb(
    () => supabaseAdmin.from("profiles")
      .select("stripe_account_id").eq("id", registeredListing.host_id).single(),
    "host_account_lookup"
  );
  if (hostError && !isMissingSupabaseRow(hostError)) throw hostError;
  const registeredHost = requirePaidCheckoutReference({ data: host, error: hostError }, "host_profile_lookup");
  // A Host's payout connection may have changed after the Driver paid:
  // do not automatically refund a paid booking on configuration drift.
  if (!registeredHost.stripe_account_id) {
    throw new PaidCheckoutReferenceError("host_account_unavailable", "account_review");
  }
  return { hostId: registeredListing.host_id, connectedAccountId: registeredHost.stripe_account_id };
}

function readCheckoutDb(query, stage) {
  return retryTransientSupabaseRead(query, {
    onRetry: (attempt) => console.warn("[webhook] retrying transient Supabase read", { stage, attempt }),
  });
}

async function validatedIntent(session, connectedAccountId, expectedConnectedAccountId, hostConnectedAccountId, expectedTotalCents, expectedApplicationFeeCents) {
  if (!connectedAccountId || connectedAccountId !== expectedConnectedAccountId
      || connectedAccountId !== hostConnectedAccountId) {
    throw new CheckoutIntegrityError("Payment is from the wrong Stripe connected account");
  }
  const intentId = typeof session.payment_intent === "string"
    ? session.payment_intent : session.payment_intent?.id;
  if (!intentId) throw new CheckoutIntegrityError("Checkout Session has no PaymentIntent");
  const intent = await stripe.paymentIntents.retrieve(intentId, {}, { stripeAccount: connectedAccountId });
  return verifyPaidCheckout({
    session,
    eventAccount: connectedAccountId,
    expectedSessionId: session.id,
    expectedConnectedAccountId,
    actualHostAccountId: hostConnectedAccountId,
    expectedTotalCents,
    expectedApplicationFeeCents,
    paymentIntent: intent,
  });
}

// Invalid payments are refunded on the originating Stripe connected account,
// not promoted into bookings or extensions. Idempotency makes retries safe.
async function refundInvalidRegisteredCheckout(session, connectedAccountId, cause) {
  console.error("[checkout-integrity] rejected paid Checkout Session:", {
    sessionId: session?.id,
    reason: cause?.message,
  });
  const paymentIntentId = typeof session?.payment_intent === "string"
    ? session.payment_intent : session?.payment_intent?.id;
  if (!connectedAccountId || !paymentIntentId || !session?.id) {
    throw new CheckoutIntegrityError("Rejected payment requires manual investigation; payment/account details missing");
  }
  await stripe.refunds.create({
    payment_intent: paymentIntentId,
    reason: "requested_by_customer",
    refund_application_fee: true,
    metadata: { parkshare_reason: "invalid_registered_checkout", checkout_session_id: session.id },
  }, {
    stripeAccount: connectedAccountId,
    idempotencyKey: `integrity-reject-${session.id}`,
  });
}

async function confirmBooking(session, connectedAccountId, hold) {
  // NEVER use Stripe-provided metadata as a booking source of truth. A
  // Standard connected-account Host can create arbitrary paid sessions.
  const metadata = verifyBookingHoldSnapshot(hold);
  const listingId = Number(hold.listing_id);
  const hours = Number(metadata.hours);
  const totalCents = Number(hold.expected_total_cents);
  const chargeAccountId = connectedAccountId;
  const host = await hostAccountForListing(listingId);
  if (String(metadata.host_id) !== String(host.hostId)) {
    throw new CheckoutIntegrityError("Checkout listing ownership has changed");
  }
  const { paymentIntentId, chargeId } = await validatedIntent(
    session, connectedAccountId, hold.expected_connected_account_id,
    host.connectedAccountId, totalCents, Number(metadata.service_fee_cents)
  );

  // A paid checkout can arrive after a Driver's profile was deleted or
  // from a misrouted environment. Check its FK parent before inserting.
  // Never synthesize profiles or auto-refund a genuine charged customer.
  const { data: renterProfile, error: renterError } = await readCheckoutDb(
    () => supabaseAdmin.from("profiles")
      .select("id").eq("id", hold.renter_id).single(),
    "paid_renter_reference_lookup"
  );
  requirePaidCheckoutReference({ data: renterProfile, error: renterError }, "renter_profile_lookup");

  const row = {
    listing_id: listingId,
    renter_id: hold.renter_id,
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
    vehicle_profile_id: metadata.vehicle_id || null,
    vehicle_type: metadata.vehicle_type || null,
    vehicle_make: metadata.vehicle_make || null,
    vehicle_model: metadata.vehicle_model || null,
    vehicle_colour: metadata.vehicle_colour || null,
    license_plate: metadata.license_plate || null,
    ...(metadata.event_id ? {
      event_id: Number(metadata.event_id),
      event_name: metadata.event_name || null,
      event_category: metadata.event_category || null,
      event_venue_name: metadata.event_venue_name || null,
      event_address: metadata.event_address || null,
      event_lat: metadata.event_lat === "" ? null : Number(metadata.event_lat),
      event_lng: metadata.event_lng === "" ? null : Number(metadata.event_lng),
      event_starts_at: metadata.event_starts_at || null,
      event_ends_at: metadata.event_ends_at || null,
      event_timezone: metadata.event_timezone || "America/Toronto",
      event_source: metadata.event_source || null,
      event_source_url: metadata.event_source_url || null,
      event_access_notes: metadata.event_access_notes || null,
      event_closure_notice: metadata.event_closure_notice || null,
    } : {}),
    paid_at: new Date().toISOString(),
  };

  // Upsert makes webhook retries safe. With ignoreDuplicates:true, Postgres
  // does ON CONFLICT DO NOTHING — a retried/duplicate webhook returns no
  // row here, which is exactly how we tell "genuinely new booking" (send
  // the confirmation email) apart from "we already processed this" (don't).
  const { data: inserted, error } = await supabaseAdmin
    .from("bookings")
    .upsert(row, { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true })
    .select("id, listing_id, renter_id, hours, total, spot_label, paid_at, booking_date, start_hour, vehicle_type, vehicle_make, vehicle_model, vehicle_colour, license_plate");
  if (error) {
    // A hold should make this exceptionally rare, but a payment can complete
    // at the exact expiry boundary. Never leave that customer charged without
    // a booking: issue an idempotent automatic refund on a database conflict.
    if (error.code === "23P01" && paymentIntentId && chargeAccountId) {
      await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          reason: "requested_by_customer",
          refund_application_fee: true,
          metadata: { parkshare_reason: "booking_conflict", checkout_session_id: session.id },
        },
        { stripeAccount: chargeAccountId, idempotencyKey: `booking-conflict-${session.id}` }
      );
      await supabaseAdmin.from("booking_holds").delete().eq("id", hold.id).eq("stripe_checkout_session_id", session.id);
      console.error("Automatically refunded conflicting paid checkout", session.id);
      return;
    }
    throw translatePaidBookingInsertError(error);
  }

  await supabaseAdmin.from("booking_holds").delete()
    .eq("id", hold.id).eq("stripe_checkout_session_id", session.id);

  if (isNewWebhookInsert(inserted)) {
    await sendBookingConfirmationEmail(inserted[0]).catch(err => {
      // Email failure should never fail the webhook / trigger a Stripe retry
      // of the whole event — the booking itself is already confirmed.
      console.error("Failed to send booking confirmation email:", err);
    });
  }
}

// Only a server-created pending extension, registered under the actual
// Stripe Checkout Session ID, can increase a reservation's duration.
async function confirmExtension(session, connectedAccountId, pending) {
  const bookingId = Number(pending.booking_id);
  const addedHours = Number(pending.added_hours);
  const totalCents = Number(pending.expected_total_cents);
  const { data: booking, error: bookingError } = await supabaseAdmin
    .from("bookings")
    .select("id, listing_id, renter_id, status, hours, stripe_connected_account_id")
    .eq("id", bookingId)
    .single();
  const registeredBooking = requirePaidCheckoutReference({ data: booking, error: bookingError }, "extension_parent_booking");
  if (registeredBooking.status !== "confirmed"
      || String(registeredBooking.renter_id) !== String(pending.renter_id)
      || registeredBooking.stripe_connected_account_id !== connectedAccountId) {
    throw new CheckoutIntegrityError("Paid extension does not match an eligible Driver booking");
  }
  const host = await hostAccountForListing(booking.listing_id);
  const { paymentIntentId, chargeId } = await validatedIntent(
    session, connectedAccountId, pending.expected_connected_account_id,
    host.connectedAccountId, totalCents, Number(pending.expected_service_fee_cents)
  );
  if (!Number.isFinite(addedHours) || addedHours <= 0 || addedHours > 24) {
    throw new CheckoutIntegrityError("Extension duration is not a valid trusted value");
  }

  // The service-role-only Postgres function inserts the extension AND extends
  // bookings.hours under one listing-scoped lock and database transaction.
  // An update conflict rolls BOTH back. Stripe retries can safely re-enter.
  // Requires the separately approved SQL proposal before QA deployment.
  const { data: rpcRows, error: applyError } = await supabaseAdmin.rpc(
    "apply_paid_booking_extension",
    {
      p_checkout_session_id: session.id,
      p_booking_id: bookingId,
      p_renter_id: pending.renter_id,
      p_added_hours: addedHours,
      p_expected_total_cents: totalCents,
      p_payment_intent_id: paymentIntentId,
      p_charge_id: chargeId,
      p_connected_account_id: connectedAccountId,
      p_paid_at: new Date().toISOString(),
    }
  );
  if (applyError) {
    // Return webhook 500 for replay/manual reconciliation; NEVER reply 200
    // when a paid extension could not be attached to the booking.
    console.error("[extension-reconciliation] paid extension NOT APPLIED", {
      sessionId: session.id, bookingId, code: applyError.code,
    });
    throw applyError;
  }
  const application = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  if (!application || typeof application.applied !== "boolean") {
    throw new Error("Paid extension did not return a trustworthy transaction result.");
  }
  if (!application.applied) return; // completed atomically in an earlier delivery

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
    .select("id, listing_id, renter_id, hours, spot_label, paid_at, booking_date, start_hour, vehicle_type, vehicle_make, vehicle_model, vehicle_colour, license_plate")
    .eq("id", bookingId)
    .single();
  if (bookingError || !booking) throw bookingError || new Error("Booking not found after extension.");

  const { data: listing } = await supabaseAdmin
    .from("listings")
    .select("address, spaces, spots, host_id")
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
  const { start, end } = getSessionWindow(booking);
  const times = formatBookingEmailTimes(start, end);

  const addedTimeStr = addedHours === 0.5 ? "30 minutes" : `${addedHours} hour${addedHours === 1 ? "" : "s"}`;
  const amountChargedStr = `${(totalCents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" })} CAD`;

  const chosenIndex = booking.spot_label
    ? booking.spot_label.trim().toUpperCase().charCodeAt(0) - 65
    : null;
  const spotStates = deriveEmailSpotStates(listing || {}, chosenIndex);

  const attachments = [];
  let logoCid, portraitCid;
  let spotImageCid;
  try {
    const imageBuffer = await renderParkingSpotImage(spotStates, chosenIndex, booking);
    spotImageCid = "parking-spot-ext-" + booking.id;
    attachments.push({
      filename: "parking-spot.png",
      content: imageBuffer.toString("base64"),
      content_id: spotImageCid,
    });
  } catch (err) {
    console.error("Failed to generate parking spot image for extension email (sending without it):", err);
  }

  try {
    const logoBuffer = await renderHostLogoPng();
    logoCid = "parkshare-signature-logo-ext-" + booking.id;
    attachments.push({ filename: "parkshare-signature-logo.png", content: logoBuffer.toString("base64"), content_id: logoCid });
  } catch (err) {
    console.error("Using hosted signature logo for extension email:", err);
  }
  try {
    const portrait = await renderDriverPortraitPng();
    portraitCid = "parkshare-parker-portrait-ext-" + booking.id;
    attachments.push({ filename: "parkshare-parker-portrait.png", content: portrait.toString("base64"), content_id: portraitCid });
  } catch (err) {
    console.error("Using hosted Parker portrait for extension email:", err);
  }

  const address = listing?.address || "";

  await sendEmail({
    to: renter.email,
    subject: `Extension confirmed — +${addedTimeStr} added`,
    html: extensionConfirmedHtml({
      logoCid,
      portraitCid,
      bookingId: booking.id,
      renterName: renter.name || "there",
      hostName,
      address,
      locationId: booking.listing_id,
      spotLabel: booking.spot_label,
      addedTime: addedTimeStr,
      amountCharged: amountChargedStr,
      newEndTime: times.endTimeStr,
      newEndDateFull: times.exitDateFull,
      vehicleSummary: [booking.vehicle_make, booking.vehicle_model, booking.vehicle_colour].filter(Boolean).join(" · ") || "Vehicle not specified",
      vehiclePlate: booking.license_plate || "Not provided",
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
    .select("title, address, spaces, spots, host_id")
    .eq("id", booking.listing_id)
    .single();
  const { data: renter } = await supabaseAdmin
    .from("profiles")
    .select("name, email")
    .eq("id", booking.renter_id)
    .single();
  let hostEmail = null;
  let hostName = "your host";
  if (listing?.host_id) {
    const { data: host } = await supabaseAdmin.from("profiles").select("name, email").eq("id", listing.host_id).single();
    hostName = host?.name || hostName;
    hostEmail = host?.email || null;
  }

  const { start, end, isAdvance } = getSessionWindow(booking);
  const formattedTimes = formatBookingEmailTimes(start, end);

  // Show the saved checkout total, including the service fee, to both
  // recipients. This is the Driver's charge, rather than the Host's payout.
  const amountCharged = booking.total != null && Number.isFinite(Number(booking.total))
    ? `${Number(booking.total).toLocaleString("en-CA", { style: "currency", currency: "CAD" })} CAD`
    : "Not provided";
  const spaces = listing?.spaces || 1;
  const chosenIndex = booking.spot_label
    ? booking.spot_label.trim().toUpperCase().charCodeAt(0) - 65
    : null;
  const spotStates = deriveEmailSpotStates(listing || { spaces }, chosenIndex);

  let attachments;
  let spotImageCid;
  try {
    const imageBuffer = await renderParkingSpotImage(spotStates, chosenIndex, booking);
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

  // Generate the same approved William-and-Parker signature logo for both
  // booking recipients. Each email has its own attachment list, keeping
  // customer and Host email content separate.
  let hostLogoCid;
  const bookingAttachments = [...(attachments || [])];
  try {
    const logoBuffer = await renderHostLogoPng();
    hostLogoCid = "parkshare-signature-logo-" + booking.id;
    bookingAttachments.push({
      filename: "parkshare-signature-logo.png",
      content: logoBuffer.toString("base64"),
      content_id: hostLogoCid,
    });
  } catch (err) {
    console.error("Unable to embed booking signature logo; using hosted PNG fallback:", err);
  }
  let driverPortraitCid;
  const driverAttachments = [...bookingAttachments];
  if (renter?.email) {
    try {
      const portrait = await renderDriverPortraitPng();
      driverPortraitCid = "parkshare-parker-portrait-" + booking.id;
      driverAttachments.push({ filename: "parkshare-parker-portrait.png", content: portrait.toString("base64"), content_id: driverPortraitCid });
    } catch (err) {
      console.error("Unable to embed Driver Parker portrait; using hosted fallback:", err);
    }
  }

  // Separate host notification prevents exposing renter email and unrelated
  // confirmation content through CC.
  const notifications = [];
  if (renter?.email) notifications.push(sendEmail({
    to: renter.email,
    subject: isAdvance ? "Booking confirmed — " + (listing?.title || "ParkShare") : "Parking authorized — " + (listing?.title || "ParkShare"),
    html: confirmationEmailHtml({
      bookingId: booking.id,
      renterName: renter.name || "there",
      hostName,
      address,
      locationId: booking.listing_id,
      spotLabel: booking.spot_label,
      confirmationNumber: "PK-" + booking.id,
      amountCharged,
      startDateLabel: formattedTimes.startDateLabel,
      startTimeStr: formattedTimes.startTimeStr,
      entryDateFull: formattedTimes.entryDateFull,
      endTimeStr: formattedTimes.endTimeStr,
      exitDateFull: formattedTimes.exitDateFull,
      vehicleSummary: [booking.vehicle_make, booking.vehicle_model, booking.vehicle_colour].filter(Boolean).join(" · ") || "Vehicle not specified",
      vehiclePlate: booking.license_plate || "Not provided",
      spotImageCid,
      logoCid: hostLogoCid,
      portraitCid: driverPortraitCid,
      directionsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
      // TODO: confirm this route actually exists in your app — this is a
      // guess based on common patterns, not read from your frontend router.
      manageReservationUrl: `https://www.myparkshare.ca/?view_booking=${booking.id}`,
      supportEmail: process.env.SUPPORT_EMAIL || "support@myparkshare.ca",
      supportPhone: process.env.SUPPORT_PHONE || "(555) 123-4567",
    }),
    attachments: driverAttachments,
  }));
  if (hostEmail && hostEmail.toLowerCase() !== renter?.email?.toLowerCase()) {
    // The Host receives the shared brand logo and their separate William
    // portrait. The Renter never receives Host-only artwork.
    let hostPortraitCid;
    const hostAttachments = [...bookingAttachments];
    try {
      const portraitBuffer = await renderHostPortraitPng();
      hostPortraitCid = "parkshare-william-portrait-" + booking.id;
      hostAttachments.push({
        filename: "parkshare-william-portrait.png",
        content: portraitBuffer.toString("base64"),
        content_id: hostPortraitCid,
      });
    } catch (err) {
      console.error("Unable to embed Host William portrait; using hosted fallback:", err);
    }
    notifications.push(sendEmail({
      to: hostEmail,
      subject: "New driveway reservation — Spot " + (booking.spot_label || "—"),
      html: hostBookingNotificationHtml({
        hostName,
        address,
        driverName: renter?.name || "ParkShare Driver",
        spotLabel: booking.spot_label,
        vehicle: booking,
        startLabel: formattedTimes.hostStartLabel,
        endLabel: formattedTimes.hostEndLabel,
        startTimeStr: formattedTimes.startTimeStr,
        entryDateFull: formattedTimes.entryDateFull,
        endTimeStr: formattedTimes.endTimeStr,
        exitDateFull: formattedTimes.exitDateFull,
        bookingId: booking.id,
        amountCharged,
        spotImageCid,
        logoCid: hostLogoCid,
        portraitCid: hostPortraitCid,
      }),
      attachments: hostAttachments,
    }));
  }
  // A failure on one email doesn't prevent attempting the other recipient.
  const outcomes = await Promise.allSettled(notifications);
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") console.error("Booking notification email failed:", outcome.reason);
  }
}

async function processPaidCheckout(session, connectedAccountId) {
  if (session.payment_status !== "paid") return;

  // Stripe can retry an already handled webhook after its short-lived hold
  // has been deleted. This check MUST precede the missing-hold rejection.
  const { data: existingBooking, error: bookedError } = await readCheckoutDb(
    () => supabaseAdmin.from("bookings").select("id")
      .eq("stripe_checkout_session_id", session.id).maybeSingle(),
    "booking_idempotency_lookup"
  );
  if (bookedError) throw bookedError;
  if (existingBooking) return;
  const { data: existingExtension, error: extendedError } = await readCheckoutDb(
    () => supabaseAdmin.from("booking_extensions").select("id")
      .eq("stripe_checkout_session_id", session.id).maybeSingle(),
    "extension_idempotency_lookup"
  );
  if (extendedError) throw extendedError;
  if (existingExtension) return;

  // Look up the session ID from trusted database rows. Do NOT select a
  // booking/extension using event.metadata.type, listing_id or booking_id.
  const { data: hold, error: holdError } = await readCheckoutDb(
    () => supabaseAdmin.from("booking_holds")
      .select("id, listing_id, renter_id, spot_label, starts_at, ends_at, expected_total_cents, expected_connected_account_id, checkout_metadata, stripe_checkout_session_id")
      .eq("stripe_checkout_session_id", session.id).maybeSingle(),
    "registered_hold_lookup"
  );
  if (holdError) throw holdError;
  if (hold) {
    try {
      await confirmBooking(session, connectedAccountId, hold);
    } catch (error) {
      if (!(error instanceof CheckoutIntegrityError)) throw error;
      await refundInvalidRegisteredCheckout(session, connectedAccountId, error);
    }
    return;
  }

  const { data: pending, error: pendingError } = await readCheckoutDb(
    () => supabaseAdmin.from("pending_booking_extensions")
      .select("booking_id, renter_id, added_hours, expected_total_cents, expected_service_fee_cents, expected_connected_account_id, stripe_checkout_session_id")
      .eq("stripe_checkout_session_id", session.id).maybeSingle(),
    "pending_extension_lookup"
  );
  if (pendingError) throw pendingError;
  if (pending) {
    try {
      await confirmExtension(session, connectedAccountId, pending);
    } catch (error) {
      if (!(error instanceof CheckoutIntegrityError)) throw error;
      await refundInvalidRegisteredCheckout(session, connectedAccountId, error);
    }
    return;
  }

  // Standard connected accounts may process unrelated transactions.
  // An unknown Stripe Session has NO trustworthy link to ParkShare, so
  // do not confirm it AND do not refund someone else's business payment.
  // An orphaned ParkShare Checkout requires separate payment reconciliation.
  console.warn("[checkout-integrity] ignored unregistered connected-account payment", {
    sessionId: session.id, connectedAccountId,
  });
}

// A signed expired/async-failed Checkout notification is NOT permission to
// mutate a paid booking. Stripe may redeliver or reorder events. Only perform
// cleanup for a still-unpaid terminal session, on its verified connected
// account and exact registered service-role hold/pending extension.
// This is read/cleanup logic only: it never creates charges or refunds.
async function processCheckoutTermination(event) {
  const session = event.data?.object;
  const connectedAccountId = event.account;
  if (!session?.id || !connectedAccountId) return;

  // The event snapshot may be stale. Fetch the actual Session directly from
  // the *same* Stripe connected account, before modifying database records.
  const current = await stripe.checkout.sessions.retrieve(
    session.id, {}, { stripeAccount: connectedAccountId }
  );
  if (typeof event.livemode !== "boolean" ||
      event.livemode !== session.livemode ||
      !isExpectedCheckoutTermination(session, current, event.type, connectedAccountId)) {
    console.warn("[checkout-terminal] ignored nonterminal or mismatched session", {
      eventId: event.id, sessionId: session.id, eventType: event.type,
      connectedAccountId,
    });
    return;
  }

  // Never change a confirmed, refunded, disputed or otherwise paid booking
  // back to "payment_failed". This check also protects already-finalized
  // Stripe Checkout sessions whose booking hold has been consumed.
  const { data: booking, error: bookingError } = await readCheckoutDb(
    () => supabaseAdmin.from("bookings")
      .select("id, status, paid_at, stripe_connected_account_id")
      .eq("stripe_checkout_session_id", session.id).maybeSingle(),
    "terminal_booking_lookup"
  );
  if (bookingError) throw bookingError;
  if (booking && !canFailUnpaidBooking(booking, connectedAccountId)) return;

  const { data: hold, error: holdError } = await readCheckoutDb(
    () => supabaseAdmin.from("booking_holds")
      .select("id, expected_connected_account_id")
      .eq("stripe_checkout_session_id", session.id).maybeSingle(),
    "terminal_registered_hold_lookup"
  );
  if (holdError) throw holdError;

  const { data: pending, error: pendingError } = await readCheckoutDb(
    () => supabaseAdmin.from("pending_booking_extensions")
      .select("id, expected_connected_account_id")
      .eq("stripe_checkout_session_id", session.id).maybeSingle(),
    "terminal_pending_extension_lookup"
  );
  if (pendingError) throw pendingError;

  // Missing or contradictory registration evidence means no destructive
  // cleanup. Host-controlled Stripe metadata cannot supply authorization.
  if (hold && pending) {
    throw new Error("Ambiguous registered checkout terminal state; manual reconciliation required.");
  }
  if (hold && !matchesRegisteredCheckoutAccount(hold, connectedAccountId)) return;
  if (pending && !matchesRegisteredCheckoutAccount(pending, connectedAccountId)) return;
  if (booking && !hold && !pending) {
    // A historic unpaid booking may exist without a current hold. Only
    // fail it if this same connected account owns it and it is still pending.
    if (!canFailUnpaidBooking(booking, connectedAccountId)) return;
  }
  if (!hold && !pending && !booking) return;

  if (hold) {
    const { error } = await supabaseAdmin.from("booking_holds").delete()
      .eq("id", hold.id)
      .eq("stripe_checkout_session_id", session.id)
      .eq("expected_connected_account_id", connectedAccountId);
    if (error) throw error;
  }
  if (pending) {
    const { error } = await supabaseAdmin.from("pending_booking_extensions").delete()
      .eq("id", pending.id)
      .eq("stripe_checkout_session_id", session.id)
      .eq("expected_connected_account_id", connectedAccountId);
    if (error) throw error;
  }
  if (event.type === "checkout.session.async_payment_failed" && booking) {
    // Defense in depth: second status predicate prevents a paid booking
    // transitioning if a paid webhook was processed after the initial read.
    const { error } = await supabaseAdmin.from("bookings")
      .update({ status: "payment_failed" })
      .eq("id", booking.id)
      .eq("stripe_checkout_session_id", session.id)
      .eq("stripe_connected_account_id", connectedAccountId)
      .eq("status", "pending")
      .is("paid_at", null);
    if (error) throw error;
  }
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
        await processPaidCheckout(session, event.account || null);
        break;
      }

      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        await processCheckoutTermination(event);
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
        const reconciliation = refundReconciliation(event.data.object);
        const target = paymentReconciliationTarget(event, "paymentIntent", reconciliation?.paymentIntentId);
        if (target) {
          const update = { status: reconciliation.status };
          if (reconciliation.status === "refunded") update.cancelled_at = new Date().toISOString();
          await applyAccountScopedBookingReconciliation(supabaseAdmin, target, update, {
            label: "charge_refunded",
            // A stale partial snapshot must not rewrite a fully refunded or
            // disputed booking. Any later dispute/refund policy is manual.
            excludeStatuses: ["refunded", "disputed"],
          });
          // Extension PaymentIntents are separate from the base booking. Audit
          // refunded amount on its own connected account without auto-revoking
          // parking time or altering the base booking.
          const extensionSnapshot = extensionChargeRefundSnapshot(event.data.object);
          if (extensionSnapshot) {
            const { error: extensionError } = await supabaseAdmin
              .from("booking_extensions")
              .update({ ...extensionSnapshot, refund_reconciled_at: new Date().toISOString() })
              .eq("stripe_payment_intent_id", reconciliation.paymentIntentId)
              .eq("stripe_connected_account_id", event.account);
            if (extensionError) throw extensionError;
          }
        }
        break;
      }

      case "refund.created":
      case "refund.updated":
      case "refund.failed": {
        const submittedRefundId = event.data.object?.id;
        // Webhook delivery can be out of order; retrieve the CURRENT refund
        // from the same connected account instead of writing a stale snapshot.
        if (!/^re_[A-Za-z0-9_]+$/.test(String(submittedRefundId || "")) ||
            !/^acct_[A-Za-z0-9_]+$/.test(String(event.account || ""))) break;
        const currentRefund = await stripe.refunds.retrieve(
          submittedRefundId, {}, { stripeAccount: event.account }
        );
        const reconciliation = refundEventReconciliation(currentRefund);
        const target = paymentReconciliationTarget(event, "paymentIntent", reconciliation?.paymentIntentId);
        if (!target || reconciliation.refundId !== submittedRefundId) break;

        // Our legacy bookings row can represent one refund identifier, not
        // multiple partial refunds for the same charge. A second refund
        // requires an audited ledger/reconciliation, never overwriting the
        // first ID and pretending financial history is complete.
        const { data: booking, error: bookingError } = await readCheckoutDb(
          () => supabaseAdmin.from("bookings")
            .select("id, stripe_refund_id")
            .eq(target.key, target.identifier)
            .eq("stripe_connected_account_id", target.connectedAccountId)
            .maybeSingle(),
          "refund_owner_lookup"
        );
        if (bookingError) throw bookingError;
        const policy = refundRecordPolicy(booking, reconciliation.refundId);
        if (policy === "manual_reconciliation") {
          console.error("[webhook-reconcile] multiple refunds require support ledger", {
            eventId: event.id, connectedAccountId: target.connectedAccountId,
          });
          throw new Error("Multiple refunds require manual reconciliation");
        }
        if (policy === "unmatched") {
          // Not a base booking refund: the PaymentIntent may belong to an
          // approved paid parking extension. Preserve its separate audit row.
          const { data: extension, error: lookupError } = await readCheckoutDb(
            () => supabaseAdmin.from("booking_extensions")
              .select("id, stripe_refund_id")
              .eq("stripe_payment_intent_id", reconciliation.paymentIntentId)
              .eq("stripe_connected_account_id", event.account)
              .maybeSingle(),
            "extension_refund_owner_lookup"
          );
          if (lookupError) throw lookupError;
          const extensionPolicy = refundRecordPolicy(extension, reconciliation.refundId);
          if (extensionPolicy === "manual_reconciliation") {
            throw new Error("Multiple extension refunds require manual reconciliation");
          }
          if (extensionPolicy === "unmatched") {
            console.warn("[webhook-reconcile] no owner-matched booking or extension refund", {
              eventId: event.id, connectedAccountId: target.connectedAccountId,
            });
            break;
          }
          let updateExtension = supabaseAdmin.from("booking_extensions")
            .update({
              stripe_refund_id: reconciliation.refundId,
              refund_status: reconciliation.refundStatus,
              refund_amount: reconciliation.refundAmount,
              refund_failure_reason: reconciliation.refundFailureReason,
              refund_reconciled_at: new Date().toISOString(),
            })
            .eq("id", extension.id)
            .eq("stripe_payment_intent_id", reconciliation.paymentIntentId)
            .eq("stripe_connected_account_id", event.account);
          updateExtension = extension.stripe_refund_id
            ? updateExtension.eq("stripe_refund_id", extension.stripe_refund_id)
            : updateExtension.is("stripe_refund_id", null);
          const { data: updatedExtension, error: extensionError } = await updateExtension.select("id");
          if (extensionError) throw extensionError;
          if (!updatedExtension?.length) {
            throw new Error("Extension refund changed concurrently; reconcile and retry");
          }
          break;
        }
        const result = await applyAccountScopedBookingReconciliation(supabaseAdmin, target, {
          stripe_refund_id: reconciliation.refundId,
          refund_status: reconciliation.refundStatus,
          refund_amount: reconciliation.refundAmount,
          refund_failure_reason: reconciliation.refundFailureReason,
        }, {
          label: "refund_lifecycle",
          // CAS: if a concurrent refund event wrote another refund ID between
          // the read and update, fail rather than overwrite its audit trail.
          expectedRefundId: booking.stripe_refund_id ?? null,
        });
        if (!result.applied) throw new Error("Refund booking changed concurrently; reconcile and retry");
        break;
      }

      case "charge.dispute.created": {
        const reconciliation = disputeReconciliation(event.data.object);
        const target = paymentReconciliationTarget(event, "charge", reconciliation?.chargeId);
        if (target) {
          await applyAccountScopedBookingReconciliation(supabaseAdmin, target,
            { status: reconciliation.status }, {
              label: "charge_dispute_created",
              // Do not overwrite settled refund records with a late dispute.
              excludeStatuses: ["refunded"],
            });
          // The extension has its own Stripe charge. Record dispute evidence
          // only for that charge on its originating connected account.
          const { error: extensionError } = await supabaseAdmin
            .from("booking_extensions")
            .update({ charge_disputed: true })
            .eq("stripe_charge_id", reconciliation.chargeId)
            .eq("stripe_connected_account_id", event.account);
          if (extensionError) throw extensionError;
        }
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    const referenceNotice = paidCheckoutReferenceLog(error, {
      eventId: event.id,
      sessionId: event.data?.object?.id,
      eventType: event.type,
      connectedAccountId: event.account || null,
      livemode: event.livemode,
    });
    if (referenceNotice) {
      // A durable payment audit / operator reconciliation is required.
      // Keep HTTP 500 for signed Stripe retry; no refund or synthetic booking.
      console.error("[paid-checkout-reference]", referenceNotice);
    } else {
      console.error(`Webhook handler failed for ${event.type}:`, error);
    }
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}
