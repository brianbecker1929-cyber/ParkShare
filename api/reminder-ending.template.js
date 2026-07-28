// "Session ending soon" reminder email — raw HTML with [VARIABLE]
// placeholders. Used only for the ENDING reminder; there is currently
// no matching design for the HALFWAY reminder (see _email.js).

export default `<!--
  PARKER — UPCOMING RESERVATION REMINDER EMAIL
  =============================================
  Fill in every [VARIABLE] before sending.

  DYNAMIC VARIABLES USED IN THIS TEMPLATE:
  [CUSTOMER_FIRST_NAME]     - e.g. "Alex"
  [GARAGE_ADDRESS]          - e.g. "123 Maple Drive, Toronto, ON M4B 2T5"

  -- Countdown banner --
  [TIME_REMAINING]          - e.g. "47 minutes"
  [SESSION_END_DATE_LABEL]  - e.g. "Today"
  [SESSION_END_TIME]        - e.g. "9:00 a.m."
  [EXIT_DATE_FULL]          - e.g. "Saturday, July 19, 2026"

  -- Location / host --
  [LOCATION_ID]             - e.g. "195"
  [HOST_NAME]                - e.g. "Green P"

  -- Spot assignment --
  [SPOT_LABEL]              - e.g. "Spot B"

  -- Parking spot map --
  [SPOT_MAP_IMAGE_URL]      - Publicly hosted URL to the SAME driveway/spot-map
                               graphic shown in the app's Review & Pay screen,
                               rendered server-side as a static PNG/JPEG for this
                               specific booking (with the correct driveway photo
                               and spot statuses already baked in).
                               e.g. "https://cdn.parkerapp.com/spot-maps/booking-284910.png"
  NOTE: this is NOT something the email template can generate — it must be
  produced by whatever backend logic renders the graphic in the app, then
  exported as an image and hosted at a stable URL per booking.

  [DIRECTIONS_URL]          - e.g. "https://maps.google.com/?q=123+Main+St"
  [MANAGE_RESERVATION_URL]  - e.g. "https://parkerapp.com/reservations/284910"
  [SUPPORT_EMAIL]           - e.g. "support@parkerapp.com"
  [SUPPORT_PHONE]           - e.g. "(555) 123-4567"
  [CURRENT_YEAR]            - e.g. "2026"
-->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Parker Reservation is Coming Up</title>
</head>
<body style="margin:0; padding:0; background-color:#f2f4f7; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f2f4f7; padding:22px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="540" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:7px; overflow:hidden; max-width:540px; width:100%;">

        <!-- ===== STATIC: HEADER / LOGO ===== -->
        <tr>
          <td style="background-color:#1b2b3a; padding:18px 29px 18px 29px; border-bottom:3px solid #f5a623;" align="center">
            <img src="https://www.myparkshare.ca/email/logo.png" alt="ParkShare" width="240" style="display:block; border:0; margin:0;">
          </td>
        </tr>

        <!-- ===== STATIC: PARKING REMINDER LOGO ===== -->
        <tr>
          <td style="padding:8px 29px 0 29px;" align="left">
            <img src="https://www.myparkshare.ca/email/reminder-headline.png" width="192" height="91" alt="Parking Reminder" style="display:block; border:0;">
          </td>
        </tr>

        <!-- ===== DYNAMIC: GREETING (with Parker character) ===== -->
        <tr>
          <td style="padding:6px 29px 0 29px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td valign="middle" style="padding-right:14px;">
                  <p style="margin:0; font-size:14px; color:#1c2b4a;">Hi [CUSTOMER_FIRST_NAME],</p>
                  <p style="margin:11px 0 0 0; font-size:14px; color:#4a5568; line-height:1.5;">
                    Your parking reservation is ending soon. Here's a quick recap.
                  </p>
                </td>
                <td width="130" valign="bottom" align="right" style="overflow:visible;">
                  <img src="https://www.myparkshare.ca/email/parker-reminder.png" alt="Parker checking the time" width="140" style="display:block; border:0; margin-top:-70px; margin-bottom:-1px; position:relative; z-index:2;">
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ===== DYNAMIC: SESSION COUNTDOWN ===== -->
        <tr>
          <td style="padding:0 29px 0 29px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background-color:#1b2b3a; border-radius:8px 8px 0 0; padding:9px 22px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td width="33" valign="middle">
                        <img src="https://www.myparkshare.ca/email/icon-clock.png" width="29" height="29" alt="Clock" style="display:block; border:0;">
                      </td>
                      <td valign="middle" style="padding-left:7px;">
                        <p style="margin:0; font-size:7px; font-weight:bold; letter-spacing:0.3px; text-transform:uppercase; color:#f5a623;">Your Parking Session</p>
                        <p style="margin:1px 0 0 0; font-size:11px; font-weight:bold; color:#ffffff;">Ends in [TIME_REMAINING]</p>
                        <p style="margin:1px 0 0 0; font-size:8px; color:#c3ccd9;">[SESSION_END_DATE_LABEL] at [SESSION_END_TIME]</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ===== BORDERED WRAPPER: details + buttons ===== -->
        <tr>
          <td style="padding:0 29px 25px 29px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #001d3d; border-top:none; border-radius:0 0 8px 8px;">

        <!-- ===== DYNAMIC: DETAILS + SPOT MAP (two-column) ===== -->
        <tr>
          <td style="padding:22px 22px 7px 22px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr valign="top">

                <!-- LEFT COLUMN: icon detail rows -->
                <td width="55%" style="padding-right:14px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

                    <!-- Row: End Time -->
                    <tr>
                      <td width="40" valign="top" style="padding-bottom:16px;">
                        <img src="https://www.myparkshare.ca/email/icon-calendar.png" width="32" height="32" alt="Session end date" style="display:block; border:0;">
                      </td>
                      <td valign="top" style="padding-bottom:16px; padding-left:11px;">
                        <p style="margin:0; font-size:14px; font-weight:bold; color:#1c2b4a;">[SESSION_END_TIME]</p>
                        <p style="margin:2px 0 0 0; font-size:12px; color:#4a5568;">[EXIT_DATE_FULL]</p>
                      </td>
                    </tr>

                    <!-- Row: Parking Address -->
                    <tr>
                      <td width="40" valign="top" style="padding-bottom:16px;">
                        <img src="https://www.myparkshare.ca/email/icon-address.png" width="32" height="32" alt="Parking address" style="display:block; border:0;">
                      </td>
                      <td valign="top" style="padding-bottom:16px; padding-left:11px;">
                        <p style="margin:0; font-size:11px; text-transform:uppercase; letter-spacing:0.45px; color:#8a94a6;">Parking Address</p>
                        <p style="margin:2px 0 0 0; font-size:13px; color:#1c2b4a; line-height:1.4;">[GARAGE_ADDRESS]</p>
                      </td>
                    </tr>

                    <!-- Row: Location ID / Host -->
                    <tr>
                      <td width="40" valign="top" style="padding-bottom:16px;">
                        <img src="https://www.myparkshare.ca/email/icon-location.png" width="32" height="32" alt="Location ID" style="display:block; border:0;">
                      </td>
                      <td valign="top" style="padding-bottom:16px; padding-left:11px;">
                        <p style="margin:0; font-size:11px; text-transform:uppercase; letter-spacing:0.45px; color:#8a94a6;">Location ID [LOCATION_ID]</p>
                        <p style="margin:2px 0 0 0; font-size:13px; color:#1c2b4a;">Host: [HOST_NAME]</p>
                      </td>
                    </tr>

                    <!-- Row: Your Spot -->
                    <tr>
                      <td width="40" valign="top">
                        <img src="https://www.myparkshare.ca/email/icon-spot.png" width="32" height="32" alt="Your spot" style="display:block; border:0;">
                      </td>
                      <td valign="top" style="padding-left:11px;">
                        <p style="margin:0; font-size:11px; text-transform:uppercase; letter-spacing:0.45px; color:#8a94a6;">Your Spot</p>
                        <p style="margin:2px 0 0 0; font-size:14px; font-weight:bold; color:#e8622c;">[SPOT_LABEL]</p>
                      </td>
                    </tr>

                  </table>
                </td>

                <!-- RIGHT COLUMN: parking spot map (server-rendered image) -->
                <td width="45%">
                  <p style="margin:0 0 7px 0; font-size:10px; font-weight:bold; text-transform:uppercase; letter-spacing:0.45px; color:#1c2b4a; text-align:center;">Your Parking Spot</p>
                  <img src="[SPOT_MAP_IMAGE_URL]" alt="Your parking spot: [SPOT_LABEL]" style="display:block; height:230px; width:auto; max-width:100%; margin:0 auto; border-radius:7px; border:1px solid #e2e6ee;">
                </td>

              </tr>
            </table>
          </td>
        </tr>

        <!-- ===== DYNAMIC: CTA BUTTONS ===== -->
        <tr>
          <td style="padding:14px 22px 0 22px;" align="center">
            <a href="[MANAGE_RESERVATION_URL]" style="display:block; background-color:#f5a623; border:3px solid #001d3d; color:#001d3d; text-decoration:none; font-size:16px; font-weight:bold; padding:14px 25px; border-radius:10px; text-align:center;">
              Add Additional Time
            </a>
            <p style="margin:6px 0 0 0; font-size:11px; color:#8a94a6; text-align:center;">Extend your session before it ends</p>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 22px 22px 22px;" align="center">
            <a href="[DIRECTIONS_URL]" style="display:block; background-color:#f5a623; border:3px solid #001d3d; color:#001d3d; text-decoration:none; font-size:16px; font-weight:bold; padding:14px 25px; border-radius:10px; text-align:center;">
              Get Directions
            </a>
            <p style="margin:6px 0 0 0; font-size:11px; color:#8a94a6; text-align:center;">Navigate to your parking spot</p>
          </td>
        </tr>

            </table>
          </td>
        </tr>

        <!-- ===== STATIC: FOOTER ===== -->
        <tr>
          <td style="background-color:#f7f9fc; padding:22px 29px; border-top:1px solid #edf0f5;" align="center">
            <img src="https://www.myparkshare.ca/email/eska-badge.png" width="140" height="46" alt="Powered by ESKA Technologies" style="display:block; border:0;">
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
