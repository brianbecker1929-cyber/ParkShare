// POST /api/cancel-booking
// Cancels an eligible booking and creates an idempotent full refund on the
// Host's connected Stripe account, including ParkShare's application fee.

import { jsonMethod, requireUser, stripe, supabaseAdmin } from "./_lib.js";
import { evaluateCancellation } from "./_cancellation-policy.js";

function refundBookingStatus(refundStatus) {
  return refundStatus === "succeeded" ? "refunded" : "confirmed";
}

function responseForExisting(booking, decision) {
  return {
    bookingId: booking.id,
    bookingStatus: booking.status,
    refundStatus: booking.refund_status || null,
    refundId: booking.stripe_refund_id || null,
    alreadyProcessed: true,
    message: decision.message,
  };
}

export default async function handler(req, res) {
  if (!jsonMethod(req, res)) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const bookingId = Number(req.body?.bookingId);
    const reason = String(req.body?.reason || "").trim().slice(0, 500) || null;
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      return res.status(400).json({ error: "Invalid booking." });
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("id, listing_id, renter_id, hours, total, status, paid_at, booking_date, start_hour, stripe_payment_intent_id, stripe_connected_account_id, cancellation_requested_at, cancelled_at, cancelled_by, stripe_refund_id, refund_status")
      .eq("id", bookingId)
      .single();
    if (bookingError || !booking) return res.status(404).json({ error: "Booking not found." });

    const { data: listing, error: listingError } = await supabaseAdmin
      .from("listings")
      .select("host_id")
      .eq("id", booking.listing_id)
      .single();
    if (listingError || !listing) return res.status(404).json({ error: "Listing not found." });

    const decision = evaluateCancellation({ booking, userId: user.id, hostId: listing.host_id });
    if (decision.idempotent) return res.status(200).json(responseForExisting(booking, decision));
    if (!decision.allowed) {
      const status = decision.code === "forbidden" ? 403 : 409;
      return res.status(status).json({ error: decision.message, code: decision.code });
    }
    if (!booking.stripe_payment_intent_id || !booking.stripe_connected_account_id) {
      return res.status(409).json({ error: "This payment cannot be automatically refunded. Please contact support.", code: "support_required" });
    }

    const requestedAt = new Date().toISOString();
    const refund = await stripe.refunds.create(
      {
        payment_intent: booking.stripe_payment_intent_id,
        reason: "requested_by_customer",
        refund_application_fee: true,
        metadata: {
          booking_id: String(booking.id),
          cancelled_by: decision.actor,
          parkshare_reason: "eligible_booking_cancellation",
        },
      },
      {
        stripeAccount: booking.stripe_connected_account_id,
        idempotencyKey: `booking-cancel-${booking.id}`,
      }
    );

    const bookingStatus = refundBookingStatus(refund.status);
    const update = {
      status: bookingStatus,
      cancellation_requested_at: requestedAt,
      cancelled_at: refund.status === "succeeded" ? requestedAt : null,
      cancelled_by: decision.actor,
      cancellation_reason: reason,
      stripe_refund_id: refund.id,
      refund_amount: Number(refund.amount || 0) / 100,
      refund_status: refund.status,
      refund_failure_reason: refund.failure_reason || null,
    };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("bookings")
      .update(update)
      .eq("id", booking.id)
      .eq("status", "confirmed")
      .select("id, status, refund_status, stripe_refund_id")
      .maybeSingle();
    if (updateError) throw updateError;

    if (!updated) {
      const { data: current, error: currentError } = await supabaseAdmin
        .from("bookings")
        .select("id, status, refund_status, stripe_refund_id")
        .eq("id", booking.id)
        .single();
      if (currentError || !current) throw currentError || new Error("Booking could not be reconciled after refund.");
      return res.status(200).json(responseForExisting(current, { message: "This cancellation was already processed." }));
    }

    if (["failed", "canceled"].includes(refund.status)) {
      return res.status(409).json({
        error: "Stripe could not complete the refund. Your booking remains confirmed and ParkShare support must review it.",
        code: "support_required",
        bookingId: updated.id,
        bookingStatus: updated.status,
        refundStatus: updated.refund_status,
      });
    }

    return res.status(200).json({
      bookingId: updated.id,
      bookingStatus: updated.status,
      refundStatus: updated.refund_status,
      refundId: updated.stripe_refund_id,
      alreadyProcessed: false,
      message: refund.status === "succeeded"
        ? "Booking cancelled. Stripe is sending your full refund."
        : "Cancellation received. Stripe is processing your full refund.",
    });
  } catch (error) {
    console.error("cancel-booking error:", error);
    return res.status(500).json({ error: "Unable to cancel this booking right now. Please try again or contact support." });
  }
}
