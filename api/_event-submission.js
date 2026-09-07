import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "./_email.js";

export const EVENT_SUBMISSION_CATEGORIES = new Set(["concert", "sports", "festival", "theatre", "community"]);

const REVIEW_EMAIL = "info@myparkshare.ca";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function optionalUrl(value) {
  const clean = text(value, 1000);
  if (!clean) return "";
  try {
    const url = new URL(clean);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function validateEventSubmission(input = {}, today = new Date()) {
  const ticketUrl = optionalUrl(input.ticketUrl);
  const eventUrl = optionalUrl(input.eventUrl);
  const value = {
    organizer_name: text(input.organizerName, 120),
    organizer_email: text(input.organizerEmail, 254).toLowerCase(),
    organizer_phone: text(input.organizerPhone, 40),
    event_name: text(input.eventName, 180),
    category: text(input.category, 40),
    venue_name: text(input.venueName, 180),
    address: text(input.address, 300),
    event_date: text(input.eventDate, 10),
    start_time: text(input.startTime, 5),
    end_time: text(input.endTime, 5),
    description: text(input.description, 5000),
    ticket_url: ticketUrl,
    event_url: eventUrl,
    access_notes: text(input.accessNotes, 2000),
  };

  if (!value.organizer_name || !EMAIL_PATTERN.test(value.organizer_email)) return { error: "Please provide a valid organizer name and email address." };
  if (!value.event_name || !value.venue_name || !value.address || !value.description) return { error: "Please complete the required event details." };
  if (!EVENT_SUBMISSION_CATEGORIES.has(value.category)) return { error: "Please select a valid event category." };
  if (!DATE_PATTERN.test(value.event_date) || !TIME_PATTERN.test(value.start_time) || (value.end_time && !TIME_PATTERN.test(value.end_time))) return { error: "Please provide a valid event date and time." };
  const todayIso = new Date(today).toISOString().slice(0, 10);
  if (value.event_date < todayIso) return { error: "The event date must be today or later." };
  if (ticketUrl === null || eventUrl === null) return { error: "Event and ticket links must begin with http:// or https://." };
  if (input.authorized !== true) return { error: "Please confirm that you are authorized to submit this event." };

  return { value };
}

export async function handleEventSubmission(req, res) {
  if (req.body?.website) return res.status(200).json({ ok: true, reference: "Submitted" });

  const validation = validateEventSubmission(req.body || {});
  if (validation.error) return res.status(400).json({ error: validation.error });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[event-submission] Missing Supabase server configuration.");
    return res.status(503).json({ error: "Event submissions are temporarily unavailable. Please try again later." });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabaseAdmin
    .from("event_submissions")
    .insert({ ...validation.value, status: "pending", submitted_from: "discover" })
    .select("id")
    .single();

  if (error) {
    console.error("[event-submission] Could not save submission:", error);
    return res.status(502).json({ error: "Your event could not be submitted right now. Please try again." });
  }

  const reference = `EVT-${String(data.id).padStart(6, "0")}`;
  const safe = Object.fromEntries(Object.entries(validation.value).map(([key, value]) => [key, escapeHtml(value)]));
  try {
    await sendEmail({
      to: REVIEW_EMAIL,
      subject: `ParkShare event submission ${reference}: ${validation.value.event_name}`,
      html: `
        <h2>New ParkShare event submission</h2>
        <p><strong>Reference:</strong> ${reference}</p>
        <p><strong>Organizer:</strong> ${safe.organizer_name} · <a href="mailto:${safe.organizer_email}">${safe.organizer_email}</a>${safe.organizer_phone ? ` · ${safe.organizer_phone}` : ""}</p>
        <p><strong>Event:</strong> ${safe.event_name}</p>
        <p><strong>Category:</strong> ${safe.category}</p>
        <p><strong>Venue:</strong> ${safe.venue_name}</p>
        <p><strong>Address:</strong> ${safe.address}</p>
        <p><strong>Schedule:</strong> ${safe.event_date} · ${safe.start_time}${safe.end_time ? `–${safe.end_time}` : ""}</p>
        <p><strong>Description:</strong><br />${safe.description.replaceAll("\n", "<br />")}</p>
        ${safe.ticket_url ? `<p><strong>Tickets:</strong> <a href="${safe.ticket_url}">${safe.ticket_url}</a></p>` : ""}
        ${safe.event_url ? `<p><strong>Event page:</strong> <a href="${safe.event_url}">${safe.event_url}</a></p>` : ""}
        ${safe.access_notes ? `<p><strong>Access notes:</strong><br />${safe.access_notes.replaceAll("\n", "<br />")}</p>` : ""}
        <p>Review this record in Supabase before publishing it to the events table.</p>
      `,
    });
  } catch (emailError) {
    // The submission is already safely stored, so an email problem must not
    // make the organizer resubmit and create duplicates.
    console.error("[event-submission] Submission saved but review email failed:", emailError);
  }

  return res.status(200).json({ ok: true, reference });
}
