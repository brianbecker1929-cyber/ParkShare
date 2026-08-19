import { sendEmail } from "./_email.js";

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@myparkshare.ca";
const HELP_TYPES = new Set(["Driver", "Host", "Booking", "Payment or Account", "Trust & Safety", "General"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const { name, email, helpType, reservationNumber, message, website } = req.body || {};
  if (website) return res.status(200).json({ ok: true });

  const cleanName = String(name || "").trim();
  const cleanEmail = String(email || "").trim();
  const cleanHelpType = String(helpType || "").trim();
  const cleanReservationNumber = String(reservationNumber || "").trim();
  const cleanMessage = String(message || "").trim();

  if (!cleanName || !EMAIL_PATTERN.test(cleanEmail) || !HELP_TYPES.has(cleanHelpType) || !cleanMessage) {
    return res.status(400).json({ error: "Please complete all required fields with valid information." });
  }

  if (cleanName.length > 120 || cleanEmail.length > 254 || cleanReservationNumber.length > 100 || cleanMessage.length > 5000) {
    return res.status(400).json({ error: "One or more fields are too long. Please shorten your message and try again." });
  }

  const safeName = escapeHtml(cleanName);
  const safeEmail = escapeHtml(cleanEmail);
  const safeHelpType = escapeHtml(cleanHelpType);
  const safeReservationNumber = escapeHtml(cleanReservationNumber || "Not provided");
  const safeMessage = escapeHtml(cleanMessage).replaceAll("\n", "<br />");

  try {
    const result = await sendEmail({
      to: SUPPORT_EMAIL,
      subject: `ParkShare Support: ${cleanHelpType}${cleanReservationNumber ? ` — ${cleanReservationNumber}` : ""}`,
      html: `
        <h2>New ParkShare support request</h2>
        <p><strong>Name:</strong> ${safeName}</p>
        <p><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>
        <p><strong>Help topic:</strong> ${safeHelpType}</p>
        <p><strong>Reservation number:</strong> ${safeReservationNumber}</p>
        <p><strong>Message:</strong><br />${safeMessage}</p>
      `,
    });

    if (result?.skipped) {
      return res.status(503).json({ error: "ParkShare Support messaging is temporarily unavailable. Please email support@myparkshare.ca directly." });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[contact] Failed to send support request:", error);
    return res.status(502).json({ error: "We couldn't send your message right now. Please try again or email support@myparkshare.ca directly." });
  }
}
