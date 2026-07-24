// api/_email.js
//
// Shared email sending helper, used by stripe-webhook.js (booking
// confirmation) and send-reminders.js (time-remaining reminders).
//
// Requires these environment variables:
//   RESEND_API_KEY — from resend.com/api-keys
//   EMAIL_FROM     — a sender address on a domain you've verified in Resend,
//                     e.g. "ParkShare <bookings@myparkshare.ca>". Until a
//                     domain is verified, Resend only lets you send to your
//                     own account email using onboarding@resend.dev — fine
//                     for testing, not for real users.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "ParkShare <onboarding@resend.dev>";

export async function sendEmail({ to, cc, subject, html }) {
  if (!RESEND_API_KEY) {
    console.error("[_email] RESEND_API_KEY is not set — skipping send:", subject);
    return { skipped: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      cc: cc ? [cc] : undefined,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
  return res.json();
}

const LOGO_URL = "https://www.myparkshare.ca/email/parker-badge.png";
const PARKER_CONFIRMATION_URL = "https://www.myparkshare.ca/email/parker-confirmation.png";
const PARKER_REMINDER_URL = "https://www.myparkshare.ca/email/parker-reminder.png";

const shell = (bodyHtml) => `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf6ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:24px 0;">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5ded1;">
          ${bodyHtml}
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

const brandHeader = () => `
  <tr><td style="background:#122233;padding:22px 24px;text-align:center;border-bottom:3px solid #ffb100;">
    <img src="${LOGO_URL}" width="52" height="52" alt="ParkShare" style="border-radius:50%;border:2px solid #ffffff;vertical-align:middle;" />
    <span style="display:inline-block;vertical-align:middle;margin-left:10px;background:#ffb100;color:#122233;font-size:22px;font-weight:800;padding:6px 16px;border-radius:20px;">Park<span style="color:#ffffff;">Share</span></span>
    <div style="color:rgba(255,255,255,0.55);font-size:11px;letter-spacing:0.08em;margin-top:10px;text-transform:uppercase;">— Parker Parks Here —</div>
  </td></tr>`;

const confirmationDetailRow = (icon, label, value, extra) => `
  <tr>
    <td style="padding:12px 0;border-bottom:1px solid #efe8db;vertical-align:top;width:32px;">
      <span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background:#122233;border-radius:6px;font-size:13px;">${icon}</span>
    </td>
    <td style="padding:12px 0 12px 12px;border-bottom:1px solid #efe8db;">
      <div style="font-size:10px;color:#78808a;letter-spacing:0.05em;text-transform:uppercase;font-weight:700;">${label}</div>
      <div style="font-size:14px;color:#122233;font-weight:700;margin-top:2px;">${value}</div>
      ${extra ? `<div style="font-size:12px;color:#78808a;margin-top:2px;">${extra}</div>` : ""}
    </td>
  </tr>`;

export function confirmationEmailHtml({ renterName, listingTitle, address, hours, total, spotLabel, dateStr, timeRangeStr, isAdvance }) {
  const greeting = isAdvance
    ? `Your parking is booked for <strong>${dateStr}</strong>. We look forward to seeing you then!`
    : `Your parking spot is all set and your session has started. We look forward to seeing you!`;
  return shell(`
    ${brandHeader()}
    <tr><td style="padding:28px 24px 8px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;">
            <div style="font-size:26px;font-weight:800;color:#122233;line-height:1.15;">BOOKING</div>
            <div style="font-size:26px;font-weight:800;color:#ffb100;line-height:1.15;margin-bottom:14px;">CONFIRMED!</div>
          </td>
          <td style="width:150px;vertical-align:top;text-align:right;">
            <img src="${PARKER_CONFIRMATION_URL}" width="140" alt="Parker" style="display:block;margin-left:auto;" />
          </td>
        </tr>
      </table>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
        <tr>
          <td style="border-top:2px solid #efe8db;width:60px;"></td>
          <td style="width:28px;height:28px;text-align:center;vertical-align:middle;background:#122233;border-radius:50%;color:#ffb100;font-size:14px;font-weight:800;">✓</td>
          <td style="border-top:2px solid #efe8db;width:60px;"></td>
        </tr>
      </table>
      <p style="font-size:14px;color:#122233;line-height:1.6;margin:0 0 20px;">
        Hi ${renterName},<br/>
        ${greeting}
      </p>
    </td></tr>

    <tr><td style="padding:0 24px;">
      <div style="background:#122233;color:#ffb100;font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:12px 16px;border-radius:8px 8px 0 0;">📅 Your Booking Details</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #efe8db;border-top:none;border-radius:0 0 8px 8px;padding:0 16px;">
        ${confirmationDetailRow("📅", "Date &amp; Time", dateStr, timeRangeStr)}
        ${confirmationDetailRow("📍", "Parking Address", listingTitle, address)}
        ${spotLabel ? confirmationDetailRow("🅿️", "Your Spot", spotLabel, "We've saved this spot just for you.") : ""}
        ${confirmationDetailRow("💳", "Payment Summary", "$" + total, "Paid")}
      </table>
      <div style="background:#fff3d6;border:1px solid #ffe1a3;border-radius:8px;padding:12px 14px;margin:14px 0 24px;font-size:12.5px;color:#122233;">
        ✉️ We'll email you a reminder before your session ends. Manage this booking anytime in the app.
      </div>
    </td></tr>

    <tr><td style="background:#faf6ef;padding:18px 24px;text-align:center;border-top:1px solid #e5ded1;">
      <p style="margin:0;font-size:11px;color:#78808a;">ParkShare · myparkshare.ca · This is an automated message about an active booking.</p>
    </td></tr>
  `);
}

function reminderEmailHtml({ kind, renterName, listingTitle, address, spotLabel, minutesLeft, endTimeStr, endDateStr }) {
  const isEnding = kind === "ending";
  const greeting = isEnding
    ? "Just a friendly reminder that your parking session is ending soon."
    : "Just a friendly reminder — you're about halfway through your parking session.";

  return shell(`
    ${brandHeader()}
    <tr><td style="padding:28px 24px 8px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;">
            <div style="font-size:26px;font-weight:800;color:#122233;line-height:1.15;">PARKING</div>
            <div style="font-size:26px;font-weight:800;color:#ffb100;line-height:1.15;margin-bottom:14px;">REMINDER</div>
          </td>
          <td style="width:150px;vertical-align:top;text-align:right;">
            <img src="${PARKER_REMINDER_URL}" width="140" alt="Parker" style="display:block;margin-left:auto;" />
          </td>
        </tr>
      </table>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
        <tr>
          <td style="border-top:2px solid #efe8db;width:60px;"></td>
          <td style="width:28px;height:28px;text-align:center;vertical-align:middle;background:#122233;border-radius:50%;color:#ffb100;font-size:13px;">🔔</td>
          <td style="border-top:2px solid #efe8db;width:60px;"></td>
        </tr>
      </table>
      <p style="font-size:14px;color:#122233;line-height:1.6;margin:0 0 20px;">
        Hi ${renterName},<br/>
        ${greeting}
      </p>
    </td></tr>

    <tr><td style="padding:0 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#122233;border-radius:8px;padding:16px 18px;">
        <tr>
          <td style="width:38px;vertical-align:top;padding-top:2px;">
            <span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border:2px solid #ffb100;border-radius:50%;color:#ffb100;font-size:14px;">⏰</span>
          </td>
          <td>
            <div style="color:#ffb100;font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;">Your Parking Session</div>
            <div style="color:#ffffff;font-size:20px;font-weight:800;margin-top:2px;">Ends in ${minutesLeft} minutes</div>
            <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:2px;">${endDateStr} at ${endTimeStr}</div>
          </td>
        </tr>
      </table>
    </td></tr>

    <tr><td style="padding:18px 24px 0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${confirmationDetailRow("⏰", "End Time", endTimeStr, endDateStr)}
        ${confirmationDetailRow("📍", "Parking Address", listingTitle, address)}
        ${spotLabel ? confirmationDetailRow("🅿️", "Your Spot", spotLabel, "We hope you're enjoying your parking experience!") : ""}
      </table>
    </td></tr>

    <tr><td style="padding:20px 24px 24px;">
      <a href="https://www.myparkshare.ca" style="display:block;text-align:center;background:#ffb100;color:#122233;font-size:14px;font-weight:800;text-decoration:none;padding:14px;border-radius:8px;">Add Additional Time</a>
    </td></tr>

    <tr><td style="background:#faf6ef;padding:18px 24px;text-align:center;border-top:1px solid #e5ded1;">
      <p style="margin:0;font-size:11px;color:#78808a;">ParkShare · myparkshare.ca · This is an automated message about an active booking.</p>
    </td></tr>
  `);
}

export function halfwayReminderHtml({ renterName, listingTitle, address, spotLabel, minutesLeft, endTimeStr, endDateStr }) {
  return reminderEmailHtml({ kind: "halfway", renterName, listingTitle, address, spotLabel, minutesLeft, endTimeStr, endDateStr });
}

export function endingReminderHtml({ renterName, listingTitle, address, spotLabel, minutesLeft, endTimeStr, endDateStr }) {
  return reminderEmailHtml({ kind: "ending", renterName, listingTitle, address, spotLabel, minutesLeft, endTimeStr, endDateStr });
}
