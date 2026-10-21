// Approved All-Caps Statement header. The transparent, 3x Poppins title PNGs
// preserve the exact typography in Gmail/Outlook without relying on web fonts.
// Native presentation tables keep the divider centered when CSS is stripped.
const headers = {
  refund: { text: true, alt: "REFUND CONFIRMED", width: 183 },
  host: { image: "host-booking", alt: "NEW BOOKING CONFIRMED!", width: 183 },
  confirmation: { image: "driver-booking", alt: "BOOKING CONFIRMED!", width: 183 },
  extension: { image: "extension-confirmed", alt: "EXTRA TIME CONFIRMED!", width: 182 },
  halfway: { image: "halfway-check-in", alt: "HALFWAY CHECK-IN", width: 194 },
  ending: { image: "parking-ending", alt: "PARKING ENDING SOON", width: 148 },
};

export const bookingHeaderStyles = `
@media only screen and (max-width:560px){
 .ps-header-logo{width:calc(51.7545vw - 10.8184px)!important;}
 ${Object.entries(headers).map(([kind, { width }]) => `.ps-title-${kind}{width:clamp(${(width * 24 / 38).toFixed(2)}px,${(width * 6.4 / 38).toFixed(4)}vw,${width}px)!important;}`).join("\n ")}
}
@media only screen and (max-width:460px){
 .ps-header-inset{height:112px!important;}
 .ps-header-grid{height:81px!important;}
 .ps-header-divider-line{height:80px!important;}
 .ps-header-logo{width:calc(44.52vw - 10.2396px)!important;}
}
@media only screen and (max-width:360px){
 .ps-header-logo{width:calc(37.842vw - 2.226px)!important;}
}`;

export function bookingHeaderTemplate(kind = "confirmation") {
  const header = headers[kind] || headers.confirmation;
  const title = header.text
    ? '<span style="display:block;color:#ffffff;">REFUND</span><span style="display:block;color:#FFC107;">CONFIRMED</span>'
    : `<img class="ps-header-title-image ps-title-${kind}" src="https://www.myparkshare.ca/email/headers/${header.image}.png" width="${header.width}" alt="${header.alt}" style="display:block;width:${header.width}px;max-width:90%;height:auto;border:0;margin:0 auto;color:#ffffff;font-family:\'Poppins\',Arial,Helvetica,sans-serif;font-size:18px;font-weight:800;">`;
  return `<tr><td class="ps-header-inset" height="160" style="height:160px;box-sizing:border-box;padding:14px 0;background:#1b2b3a;border-bottom:3px solid #f5a623;">
 <table role="presentation" class="ps-header-grid" width="100%" height="128" cellpadding="0" cellspacing="0" border="0" style="width:100%;height:128px;table-layout:fixed;border-collapse:collapse;"><tr>
 <td class="ps-header-logo-col" align="center" valign="middle" style="padding:0;vertical-align:middle;text-align:center;"><img class="ps-header-logo" src="[BOOKING_LOGO_URL]" alt="ParkShare — William and Parker with the signature wordmark" width="300" style="display:block;width:299.71px;max-width:100%;height:auto;border:0;margin:0 auto;"></td>
 <td class="ps-header-divider" width="3" align="center" valign="middle" aria-hidden="true" style="width:3px;padding:0;vertical-align:middle;font-size:0;line-height:0;"><table role="presentation" width="3" cellpadding="0" cellspacing="0" border="0" style="width:3px;border-collapse:collapse;"><tr><td class="ps-header-divider-line" height="120" style="height:120px;background:#FFC107;padding:0;font-size:0;line-height:0;">&nbsp;</td></tr></table></td>
 <td class="ps-header-title-col" align="center" valign="middle" style="padding:0;vertical-align:middle;text-align:center;"><h1 class="ps-header-title" style="margin:0;padding:0;font-family:'Poppins',Arial,Helvetica,sans-serif;font-size:24px;font-weight:800;line-height:1.1;color:#ffffff;text-align:center;">${title}</h1></td>
 </tr></table>
</td></tr>`;
}
