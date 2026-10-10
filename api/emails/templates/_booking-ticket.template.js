// Shared, approved Booking Ticket layout. Tables and inline styles keep the
// compact design readable even when an email client ignores media queries.
const labelStyle = "margin:0 0 3px;font-size:11px;line-height:15px;letter-spacing:.5px;text-transform:uppercase;color:#617080;";

function action(label, url, secondary = false) {
  return `<a href="${url}" style="display:block;padding:11px 7px;background:${secondary ? '#ffffff' : '#f5a623'};color:#0e1b2e;border:2px solid #0e1b2e;border-radius:7px;text-align:center;text-decoration:none;font-size:14px;line-height:18px;font-weight:bold;">${label}</a>`;
}

export function bookingTicketTemplate({
  title, accent, preheader, name, message, status, reference,
  addressLabel = "Parking address", address = "[GARAGE_ADDRESS]",
  portrait = "[DRIVER_PORTRAIT_URL]", portraitAlt = "Parker holding his phone with the ParkShare app",
  leftLabel, leftValue, leftDate, rightLabel, rightValue, rightDate,
  partyLabel = "Host", partyName = "[HOST_NAME]", location = true,
  vehicleLabel = "Your vehicle", vehicle = "[BOOKED_VEHICLE_SUMMARY]", plate = "[BOOKED_VEHICLE_PLATE]",
  payment = false, primaryLabel, primaryUrl, secondaryLabel, secondaryUrl, actionNote,
}) {
  const buttons = secondaryLabel
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;"><tr><td width="50%" style="padding-right:5px;">${action(primaryLabel, primaryUrl)}</td><td width="50%" style="padding-left:5px;">${action(secondaryLabel, secondaryUrl, true)}</td></tr></table>`
    : action(primaryLabel, primaryUrl);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>${title} ${accent}</title>
<style>
@media only screen and (max-width:460px){
 .ps-ticket-inset{padding-left:16px!important;padding-right:16px!important;}
 .ps-ticket-portrait-col,.ps-ticket-portrait{width:96px!important;}
 .ps-ticket-title{font-size:20px!important;line-height:24px!important;}
 .ps-ticket-map-col{width:145px!important;padding-right:12px!important;}
 .ps-ticket-map{width:145px!important;}
 .ps-ticket-time{font-size:17px!important;line-height:22px!important;}
}
</style></head>
<body style="margin:0;padding:0;background:#ffffff;color:#0e1b2e;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#ffffff;border-collapse:collapse;"><tr><td align="center" style="padding:12px 0;">
<table role="presentation" class="ps-booking-ticket" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-collapse:collapse;">
<tr><td align="center" style="padding:8px 18px;background:#1b2b3a;border-bottom:3px solid #f5a623;"><img src="[BOOKING_LOGO_URL]" alt="ParkShare — William and Parker with the signature wordmark" width="190" style="display:block;width:190px;max-width:100%;height:auto;border:0;margin:0 auto;"></td></tr>
<tr><td class="ps-ticket-inset" style="padding:14px 16px 0;">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;"><tr>
 <td valign="middle" style="vertical-align:middle;padding-right:10px;word-wrap:break-word;">
  <p class="ps-ticket-title" style="margin:0;font-size:23px;line-height:27px;font-weight:bold;letter-spacing:-.4px;color:#0e1b2e;">${title} <span style="color:#b57b00;">${accent}</span></p>
  <p style="margin:8px 0 0;font-size:13px;line-height:18px;color:#0e1b2e;">Hi <strong>${name}</strong>,</p>
  <p style="margin:4px 0 10px;font-size:12px;line-height:17px;color:#617080;">${message}</p>
 </td><td class="ps-ticket-portrait-col" width="112" valign="bottom" style="width:112px;vertical-align:bottom;padding:0;line-height:0;"><img class="ps-ticket-portrait" src="${portrait}" width="112" alt="${portraitAlt}" style="display:block;width:112px;max-width:100%;height:auto;border:0;margin:0;"></td>
 </tr></table>
</td></tr>
<tr><td class="ps-ticket-inset" style="padding:0 16px;">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#fff8e1;border:1px solid #eadcb6;border-radius:6px;table-layout:fixed;"><tr><td style="padding:9px 12px;word-wrap:break-word;"><p style="margin:0;font-size:13px;line-height:18px;font-weight:bold;color:#0e1b2e;">${status}</p><p style="margin:1px 0 0;font-size:11px;line-height:15px;color:#617080;">${reference}</p></td><td width="72" align="right" style="width:72px;padding:9px 12px 9px 0;"><span style="display:inline-block;padding:5px 8px;border-radius:5px;background:#f5a623;color:#0e1b2e;font-size:13px;line-height:18px;font-weight:bold;">[SPOT_LABEL]</span></td></tr></table>
</td></tr>
<tr><td class="ps-ticket-inset" style="padding:12px 16px;">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;"><tr><td width="37" valign="top" style="width:37px;vertical-align:top;"><img src="https://www.myparkshare.ca/email/icon-address.png" width="27" height="27" alt="" style="display:block;border:0;"></td><td valign="top" style="vertical-align:top;word-wrap:break-word;"><p style="${labelStyle}">${addressLabel}</p><p style="margin:0;font-size:14px;line-height:20px;font-weight:bold;color:#0e1b2e;">${address}</p></td></tr></table>
</td></tr>
<tr><td class="ps-ticket-inset" style="padding:12px 16px;background:#1b2b3a;">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;"><tr>
 <td width="50%" valign="top" style="padding-right:6px;vertical-align:top;word-wrap:break-word;"><p style="margin:0 0 3px;font-size:11px;line-height:15px;letter-spacing:.5px;text-transform:uppercase;color:#d7e0e9;">${leftLabel}</p><p class="ps-ticket-time" style="margin:0;font-size:18px;line-height:24px;font-weight:bold;color:#ffffff;">${leftValue}</p><p style="margin:2px 0 0;font-size:12px;line-height:17px;color:#d7e0e9;">${leftDate}</p></td>
 <td width="50%" valign="top" style="padding-left:6px;vertical-align:top;word-wrap:break-word;"><p style="margin:0 0 3px;font-size:11px;line-height:15px;letter-spacing:.5px;text-transform:uppercase;color:#d7e0e9;">${rightLabel}</p><p class="ps-ticket-time" style="margin:0;font-size:18px;line-height:24px;font-weight:bold;color:#ffffff;">${rightValue}</p><p style="margin:2px 0 0;font-size:12px;line-height:17px;color:#d7e0e9;">${rightDate}</p></td>
 </tr></table>
</td></tr>
<tr><td class="ps-ticket-inset" style="padding:5px 16px 0;"><p style="margin:0;font-size:11px;line-height:15px;color:#617080;">Toronto local time</p>${payment ? '<p style="margin:7px 0 0;font-size:12px;line-height:17px;color:#617080;">Amount charged: <strong style="color:#0e1b2e;">[AMOUNT_CHARGED]</strong></p>' : ''}</td></tr>
<tr><td class="ps-ticket-inset" style="padding:12px 16px 14px;">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;border-top:1px dashed #b9c1cd;border-bottom:1px dashed #b9c1cd;"><tr>
 <td class="ps-ticket-map-col" width="197" valign="middle" style="width:197px;padding:12px 17px 12px 0;vertical-align:middle;"><p style="${labelStyle}text-align:center;">Reserved space · [SPOT_LABEL]</p>[SPOT_MAP_BLOCK]</td>
 <td valign="middle" style="padding:12px 0;vertical-align:middle;word-wrap:break-word;">
 <p style="${labelStyle}">${vehicleLabel}</p><p style="margin:0;font-size:14px;line-height:20px;font-weight:bold;color:#0e1b2e;">${vehicle}</p>
 <p style="margin:5px 0 0;font-size:11px;line-height:15px;color:#617080;">Licence plate</p><p style="margin:3px 0 0;"><span style="display:inline-block;padding:4px 8px;background:#1b2b3a;color:#ffffff;border:1px solid #f5a623;border-radius:4px;font-size:13px;line-height:18px;font-weight:bold;letter-spacing:1px;word-break:break-all;">${plate}</span></p>
 <p style="${labelStyle}margin-top:12px;">${partyLabel}</p><p style="margin:0;font-size:14px;line-height:20px;font-weight:bold;color:#0e1b2e;">${partyName}</p>
 ${location ? '<p style="margin:5px 0 0;font-size:11px;line-height:15px;color:#617080;">Location ID [LOCATION_ID]</p>' : ''}
 <p style="margin:12px 0 0;font-size:11px;line-height:15px;color:#617080;">Reserved space and vehicle reference, not confirmation that the vehicle has arrived.</p>
 </td></tr></table>
</td></tr>
<tr><td class="ps-ticket-inset" style="padding:0 16px 16px;">${buttons}<p style="margin:6px 0 0;font-size:11px;line-height:16px;text-align:center;color:#617080;">${actionNote}</p></td></tr>
<tr><td align="center" style="padding:13px 18px;background:#1b2b3a;border-top:3px solid #f5a623;">
 <p style="margin:0;font-size:12px;line-height:18px;color:#ffd46e;"><a href="mailto:info@myparkshare.ca" style="color:#ffd46e;text-decoration:none;">info@myparkshare.ca</a> · <a href="https://www.myparkshare.ca" style="color:#ffd46e;text-decoration:none;">www.myparkshare.ca</a></p>
 <p style="margin:5px 0 0;font-size:11px;line-height:17px;color:#d7e0e9;"><a href="https://facebook.com/myparkshare" style="color:#d7e0e9;text-decoration:none;">Facebook</a> · <a href="https://twitter.com/myparkshare" style="color:#d7e0e9;text-decoration:none;">Twitter</a> · <a href="https://youtube.com/@myparkshare" style="color:#d7e0e9;text-decoration:none;">YouTube</a> · <a href="https://linkedin.com/company/myparkshare" style="color:#d7e0e9;text-decoration:none;">LinkedIn</a></p>
 <p style="margin:4px 0 0;font-size:11px;line-height:16px;color:#b5c1ce;">Automatic email; replies may not be monitored.</p>
 <img src="https://www.myparkshare.ca/email/eska-badge-on-navy.png" width="105" alt="Powered by ESKA Technologies" style="display:block;width:105px;max-width:100%;height:auto;margin:8px auto 0;border:0;">
</td></tr>
</table></td></tr></table></body></html>`;
}
