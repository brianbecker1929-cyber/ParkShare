// Persist the full provider request so uncertain network outcomes can safely
// retry with Resend's 24-hour idempotency cache. Stop retries at 23 hours.
import { buildEmailPayload, sendEmailPayload } from "./_email.js";
import { getSessionWindow } from "./_booking-rules.js";
import { createHash } from "node:crypto";

export async function deliverReminder(db, booking, kind, message, now = new Date()) {
  const id = `booking-${booking.id}-${kind}`;
  const column = kind === "halfway" ? "reminder_halfway_sent_at" : "reminder_ending_sent_at";
  const table = () => db.from("booking_reminder_deliveries");
  const check = (result, action) => {
    if (result.error) throw new Error(`Reminder ${action} failed`);
    return result.data;
  };
  check(await table().upsert({ id, booking_id: booking.id, kind,
    session_ends_at: new Date(booking.end).toISOString(), payload: buildEmailPayload(message),
  }, { onConflict: "id", ignoreDuplicates: true }), "snapshot");
  let delivery = check(await table().select("id, payload, session_ends_at, created_at, sent_at, provider_id")
    .eq("id", id).single(), "lookup");
  if (!delivery.sent_at) {
    if (now.getTime() - Date.parse(delivery.created_at) >= 23 * 3600_000) {
      throw new Error("Reminder delivery requires reconciliation after retry deadline");
    }
    if (Date.parse(delivery.session_ends_at) !== booking.end) {
      throw new Error("Reminder session changed; stale email suppressed");
    }
    const claimed = check(await table().update({ lease_until: new Date(now.getTime() + 120_000).toISOString() })
      .eq("id", id).is("sent_at", null).lte("lease_until", now.toISOString()).select("id").maybeSingle(), "claim");
    if (!claimed) return false;
    // Recheck after rendering/claiming: cancellation or extension may have
    // happened since the cron's initial scan.
    const current = check(await db.from("bookings").select("status, paid_at, hours, booking_date, start_hour, scheduled_starts_at")
      .eq("id", booking.id).single(), "session recheck");
    const window = getSessionWindow(current);
    const clock = Date.now();
    if (current.status !== "confirmed" || !current.paid_at || window.end.getTime() !== booking.end
        || clock < window.start.getTime() || clock >= booking.end
        || (kind === "halfway" && clock >= booking.end - 15 * 60_000)) return false;
    // QA and production may share a Resend account and overlapping booking
    // IDs. Scope the provider key to the database, independently of aliases.
    const project = createHash("sha256").update(process.env.SUPABASE_URL || "local-test").digest("hex").slice(0, 16);
    const accepted = await sendEmailPayload(delivery.payload, { idempotencyKey: `parkshare-${project}-${id}` });
    if (!accepted?.id || accepted.skipped) throw new Error("Reminder email was not accepted");
    delivery = { ...delivery, provider_id: accepted.id, sent_at: new Date().toISOString() };
    // Save acceptance before the legacy booking marker. A failed marker update
    // is repaired on the next run without another provider request.
    check(await table().update({ provider_id: delivery.provider_id, sent_at: delivery.sent_at })
      .eq("id", id), "acceptance update");
  }
  check(await db.from("bookings").update({ [column]: delivery.sent_at }).eq("id", booking.id), "booking marker");
  return true;
}
