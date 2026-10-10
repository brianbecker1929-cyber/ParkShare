// Host-facing booking confirmation. Uses the same 640px/table-based email
// system, colours, image assets and footer as the approved Driver confirmation.
// All [PLACEHOLDERS] are escaped in api/_email.js before fillTemplate().
// Avoid CSS positioning/flexbox for compatibility with Gmail and Outlook.
const asset = "https://www.myparkshare.ca/email";
const row = (icon, label, value, sub = "") => `
<tr>
  <td width="42" valign="top" style="width:42px;padding:0 0 17px 0;vertical-align:top;">
    <img src="${asset}/${icon}" alt="" width="30" height="30" style="display:block;width:30px;height:30px;border:0;">
  </td>
  <td valign="top" style="padding:0 0 17px 9px;vertical-align:top;word-break:break-word;">
    <p style="margin:0 0 4px;font-size:11px;line-height:16px;color:#778399;letter-spacing:.5px;text-transform:uppercase;">${label}</p>
    <p style="margin:0;font-size:14px;line-height:21px;color:#1c2b4a;font-weight:700;">${value}</p>
    ${sub ? `<p style="margin:3px 0 0;font-size:12px;line-height:17px;color:#596675;">${sub}</p>` : ""}
  </td>
</tr>`;

export default `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>New ParkShare driveway booking</title>
<style>
@media only screen and (max-width:640px) {
  .ps-email-wrap { width:100% !important; }
  .ps-email-inset { padding-left:16px !important; padding-right:16px !important; }
  .ps-host-portrait { width:112px !important; }
  .ps-host-copy { font-size:13px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;color:#1c2b4a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">A driver has reserved [SPOT_LABEL]. See the booked vehicle and arrival time.</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background:#ffffff;border-collapse:collapse;">
<tr><td align="center" style="padding:22px 0;">
  <table role="presentation" class="ps-email-wrap" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;border-collapse:collapse;background:#ffffff;">

    <!-- ParkShare brand: same header as the Driver booking confirmation -->
    <tr><td align="center" class="ps-email-inset" style="padding:18px 29px;background:#1b2b3a;border-bottom:3px solid #f5a623;">
      <img src="[HOST_LOGO_URL]" alt="ParkShare — William and Parker with the signature wordmark" width="360" style="display:block;width:360px;max-width:100%;height:auto;border:0;">
    </td></tr>

    <!-- Host variant of the Driver confirmation headline and mascot greeting -->
    <tr><td class="ps-email-inset" style="padding:22px 29px 4px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%;">
        <tr>
          <td valign="middle" style="padding:0 9px 0 0;vertical-align:middle;">
            <p style="margin:0;font-size:22px;line-height:27px;font-weight:900;letter-spacing:-.5px;color:#1c2b4a;">NEW BOOKING<br><span style="color:#e8a400;">CONFIRMED!</span></p>
            <p class="ps-host-copy" style="margin:13px 0 4px;font-size:14px;line-height:20px;color:#1c2b4a;">Hi <strong>[HOST_NAME]</strong>,</p>
            <p class="ps-host-copy" style="margin:7px 0 0;font-size:13px;line-height:20px;color:#4a5568;">A driver has reserved a space at your property. Here's what to expect.</p>
          </td>
          <td valign="bottom" width="118" align="right" style="width:118px;min-width:100px;vertical-align:bottom;">
            <img class="ps-host-portrait" src="https://www.myparkshare.ca/william-v3/masters/ParkShare_William_05_Presenting.png" width="118" alt="William, your ParkShare hosting guide" style="display:block;width:118px;max-width:100%;height:auto;border:0;">
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- Consistent navy booking status banner -->
    <tr><td class="ps-email-inset" style="padding:0 29px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
        <tr><td style="background:#1b2b3a;padding:12px 19px;border-radius:8px 8px 0 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
            <td width="38" valign="middle"><img src="${asset}/icon-clock.png" alt="" width="29" height="29" style="display:block;border:0;"></td>
            <td valign="middle" style="padding-left:5px;">
              <p style="margin:0 0 4px;color:#f5a623;letter-spacing:.6px;font-size:10px;font-weight:bold;text-transform:uppercase;">New driveway reservation</p>
              <p style="margin:0;color:#ffffff;font-size:14px;font-weight:bold;line-height:20px;">Confirmation #[BOOKING_NUMBER]</p>
              <p style="margin:3px 0 0;color:#c3ccd9;font-size:11px;line-height:16px;">[START_TIME_SUMMARY] · [SPOT_LABEL]</p>
            </td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>

    <!-- Inset bordered reservation detail panel -->
    <tr><td class="ps-email-inset" style="padding:0 29px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:2px solid #001d3d;border-top:0;border-radius:0 0 8px 8px;border-collapse:separate;">
        <tr><td style="padding:22px 21px 5px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
            ${row("icon-address.png", "Your property", "[PROPERTY_ADDRESS]")}
            ${row("icon-spot.png", "Reserved parking space", '<span style="color:#e8622c;">[SPOT_LABEL]</span>')}
            ${row("icon-calendar.png", "Arrival / Start", "[START_DATE_TIME]", "Toronto local time")}
            ${row("icon-calendar.png", "Departure / End", "[END_DATE_TIME]", "Toronto local time")}
            ${row("icon-location.png", "Driver", "[DRIVER_NAME]")}
            ${row("icon-spot.png", "Vehicle to expect", "[VEHICLE_DETAILS]", "Licence plate: [VEHICLE_PLATE]")}
          </table>
        </td></tr>

        <!-- Highlight: host should be able to recognize the expected vehicle at a glance -->
        <tr><td style="padding:2px 21px 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#fff8e1;border:1px solid #e3ddc9;border-radius:7px;">
            <tr><td align="center" style="padding:12px;">
              <p style="margin:0 0 4px;font-size:12px;line-height:18px;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;color:#1c2b4a;">Expected vehicle · [SPOT_LABEL]</p>
              <p style="margin:0;font-size:13px;line-height:19px;font-weight:bold;color:#1c2b4a;">[VEHICLE_DETAILS] · [VEHICLE_PLATE]</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Server-generated PNG attached inline to each booking notification -->
        <tr><td align="center" style="padding:7px 18px 8px;">
          <p style="margin:0 0 11px;font-size:12px;color:#1c2b4a;font-weight:bold;letter-spacing:.5px;text-transform:uppercase;">Reserved parking space</p>
          [SPOT_MAP_BLOCK]
          <p style="margin:10px auto 0;max-width:440px;font-size:11px;line-height:17px;color:#71695a;text-align:center;">This is a visual reference of the reserved space and expected vehicle, not confirmation that the vehicle has arrived.</p>
        </td></tr>

        <!-- Host CTA uses a real, existing private route: /host-dashboard -->
        <tr><td align="center" style="padding:12px 21px 22px;">
          <a href="[HOST_DASHBOARD_URL]" style="display:block;padding:14px 16px;background:#f5a623;color:#001d3d;border:3px solid #001d3d;border-radius:10px;text-align:center;font-size:16px;line-height:21px;font-weight:bold;text-decoration:none;">Open Host Dashboard</a>
          <p style="margin:7px 0 0;font-size:11px;line-height:16px;color:#8a94a6;">View your upcoming reservations and manage your listings.</p>
        </td></tr>
      </table>
    </td></tr>

    <!-- Same footer treatment, social links and ESKA badge as Driver email -->
    <tr><td align="center" class="ps-email-inset" style="background:#1b2b3a;border-top:3px solid #f5a623;padding:22px 29px;">
      <p style="margin:0 0 14px;font-size:12px;line-height:19px;color:#c3cbd6;">
        Need help with a booking? Email <a href="mailto:info@myparkshare.ca" style="color:#f5a623;text-decoration:none;">info@myparkshare.ca</a>.<br>
        Visit <a href="https://www.myparkshare.ca" style="color:#f5a623;text-decoration:none;">www.myparkshare.ca</a>
      </p>
      <p style="margin:0 0 14px;font-size:12px;line-height:21px;color:#c3cbd6;">Follow MyParkShare on<br>
        <a href="https://facebook.com/myparkshare" style="color:#f5a623;text-decoration:none;">Facebook</a> &nbsp;|&nbsp;
        <a href="https://twitter.com/myparkshare" style="color:#f5a623;text-decoration:none;">Twitter</a> &nbsp;|&nbsp;
        <a href="https://youtube.com/@myparkshare" style="color:#f5a623;text-decoration:none;">YouTube</a> &nbsp;|&nbsp;
        <a href="https://linkedin.com/company/myparkshare" style="color:#f5a623;text-decoration:none;">LinkedIn</a>
      </p>
      <p style="margin:0 0 15px;color:#8a94a6;font-size:11px;line-height:17px;">This is an automatically generated email; replies may not be monitored.</p>
      <img src="${asset}/eska-badge-on-navy.png" width="140" height="48" alt="Powered by ESKA Technologies" style="display:block;border:0;">
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
