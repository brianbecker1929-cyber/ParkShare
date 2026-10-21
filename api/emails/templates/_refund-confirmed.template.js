import { bookingHeaderStyles, bookingHeaderTemplate } from './_booking-header.template.js';

// Refund receipt uses the approved logo, colours and signature portraits.
// No reserved-bay illustration: a refund does not imply a new reservation.
export default `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ParkShare refund confirmed</title><style>${bookingHeaderStyles}
@media only screen and (max-width:460px){.refund-body{padding:18px!important;}.refund-portrait{width:90px!important;}}
</style></head><body style="margin:0;background:#ffffff;color:#0e1b2e;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">[REFUND_AMOUNT] CAD refund confirmed for booking [BOOKING_NUMBER].</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:collapse;">
${bookingHeaderTemplate('refund')}
<tr><td class="refund-body" style="padding:24px;">
<table role="presentation" width="100%"><tr><td valign="middle"><p style="font-size:15px;">Hi <strong>[RECIPIENT_NAME]</strong>,</p><p style="font-size:14px;line-height:21px;">[REFUND_MESSAGE]</p></td><td width="112" valign="bottom"><img class="refund-portrait" src="[PORTRAIT_URL]" width="112" alt="[PORTRAIT_ALT]" style="display:block;width:112px;height:auto;border:0;"></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1b2b3a;color:#ffffff;border-radius:6px;"><tr><td style="padding:16px;"><p style="margin:0 0 5px;font-size:12px;">REFUND CONFIRMED</p><p style="margin:0;font-size:25px;font-weight:bold;color:#FFC107;">[REFUND_AMOUNT] CAD</p><p style="margin:8px 0 0;font-size:12px;">Refund reference: [REFUND_REFERENCE]</p></td></tr></table>
<p style="font-size:14px;line-height:22px;"><strong>Booking [BOOKING_NUMBER]</strong><br>[PROPERTY_ADDRESS]<br>[SPOT_LABEL]<br>[VEHICLE_DETAILS]</p>
<p style="font-size:13px;line-height:21px;"><strong>Reservation times:</strong><br>[SESSION_START] – [SESSION_END]<br>[TIME_ZONE_LABEL]</p>
<p style="padding:12px;background:#fff8e1;border:1px solid #eadcb6;font-size:14px;line-height:21px;">[BOOKING_OUTCOME]</p>
<p style="font-size:13px;line-height:21px;">[PAYMENT_NOTE]</p>
<p style="margin:20px 0;"><a href="[BOOKING_URL]" style="display:inline-block;padding:12px 18px;background:#FFC107;color:#0e1b2e;border:2px solid #0e1b2e;border-radius:7px;font-size:14px;font-weight:bold;text-decoration:none;">View Booking</a></p>
<p style="font-size:12px;line-height:19px;">Questions? <a href="mailto:[SUPPORT_EMAIL]" style="color:#0e1b2e;">[SUPPORT_EMAIL]</a><br>This is an automatic refund receipt.</p>
</td></tr><tr><td align="center" style="padding:16px;background:#1b2b3a;color:white;font-size:12px;"><a href="https://www.myparkshare.ca" style="color:#FFC107;">www.myparkshare.ca</a></td></tr>
</table></td></tr></table></body></html>`;
