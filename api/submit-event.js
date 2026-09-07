import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "./_email.js";
import { validateEventSubmission } from "./_event-submission.js";

const REVIEW_EMAIL = "info@myparkshare.ca";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (req.body?.website) return res.status(200).json({ ok: true, reference: "Submitted" });

  const validation = validateEventSubmission(req.body || {});
  if (validation.error) return res.status(400).json({ error: validation.error });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[submit-event] Missing Supabase server configuration.");
    return res.status(503).json({ error: "Event submissions are temporarily unavailable. Please try again later." });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabaseAdmin
    .from("event_submissions")
    .insert({ ...validation.value, status: "pending", submitted_from: "discover" })
    .select("id")
    .single();

  if (error) {
    console.error("[submit-event] Could not save submission:", error);
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
    console.error("[submit-event] Submission saved but review email failed:", emailError);
  }

  return res.status(200).json({ ok: true, reference });
}

