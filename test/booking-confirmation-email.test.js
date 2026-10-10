import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { formatBookingEmailTimes } from "../api/_booking-email-times.js";
import { renderParkingSpotImage } from "../api/_driveway-image.js";
import { confirmationEmailHtml } from "../api/_email.js";

test("October booking email matches Toronto daylight time, not the server's UTC clock", () => {
  const start = new Date("2026-10-09T11:20:00.000Z"); // 7:20 a.m. EDT
  const end = new Date("2026-10-09T12:20:00.000Z");
  const t = formatBookingEmailTimes(start, end, start);
  assert.match(t.startTimeStr, /7:20/);
  assert.match(t.endTimeStr, /8:20/);
  assert.doesNotMatch(t.startTimeStr, /11:20/);
  assert.equal(t.startDateLabel, "Today");
  assert.match(t.entryDateFull, /October 9, 2026/);
  assert.match(t.hostStartLabel, /7:20/);
});

test("December email uses Toronto standard time and adjusts daylight saving automatically", () => {
  const start = new Date("2026-12-09T12:20:00.000Z"); // 7:20 a.m. EST
  const t = formatBookingEmailTimes(start, new Date(start.getTime() + 3600_000), start);
  assert.match(t.startTimeStr, /7:20/);
  assert.match(t.endTimeStr, /8:20/);
});

test("Today compares Toronto calendar dates, including UTC date rollover", () => {
  const start = new Date("2026-10-10T02:30:00Z"); // Oct 9 at 10:30 p.m. EDT
  const now = new Date("2026-10-10T03:00:00Z");
  const t = formatBookingEmailTimes(start, new Date(start.getTime() + 3600_000), now);
  assert.equal(t.startDateLabel, "Today");
  assert.match(t.entryDateFull, /October 9, 2026/);
  assert.match(t.exitDateFull, /October 9, 2026/);
});

test("rendered email driveway graphic contains booked vehicle colour in the right spot", async () => {
  const spotStates = [false, true, false, false];
  const yellow = await renderParkingSpotImage(spotStates, 1, {
    vehicle_make: "INFINITI", vehicle_model: "Q30", vehicle_colour: "Yellow",
  });
  const silver = await renderParkingSpotImage(spotStates, 1, {
    vehicle_make: "BMW", vehicle_model: "X4", vehicle_colour: "Silver",
  });
  const [y, s] = await Promise.all([sharp(yellow).metadata(), sharp(silver).metadata()]);
  assert.equal(y.format, "png");
  assert.equal(y.width, 500);
  assert.equal(s.width, 500);
  assert.equal(y.height, s.height);
  assert.notDeepEqual(yellow, silver, "Changing the vehicle must affect the email PNG");
  const rawY = await sharp(yellow).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rawS = await sharp(silver).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let changedPixels = 0;
  for (let i = 0; i < rawY.data.length; i += 3) {
    if (Math.abs(rawY.data[i] - rawS.data[i]) + Math.abs(rawY.data[i + 1] - rawS.data[i + 1]) + Math.abs(rawY.data[i + 2] - rawS.data[i + 2]) > 40) changedPixels++;
  }
  assert.ok(changedPixels > 100, `Vehicle colour should visibly change the rendered booking diagram, got ${changedPixels} pixels`);
});

test("driver confirmation names booked vehicle and renders matched CID image", () => {
  const html = confirmationEmailHtml({
    renterName: "Driver",
    hostName: "Host",
    address: "Example driveway",
    locationId: "14",
    spotLabel: "B",
    confirmationNumber: "PK-22",
    startDateLabel: "Today",
    startTimeStr: "7:20 a.m.",
    entryDateFull: "Fri, October 9, 2026",
    endTimeStr: "8:20 a.m.",
    exitDateFull: "Fri, October 9, 2026",
    spotImageCid: "parking-spot-22",
    vehicleSummary: "INFINITI · Q30 · Yellow",
    vehiclePlate: "ABCD 123",
    directionsUrl: "https://example.com/directions",
    manageReservationUrl: "https://example.com/booking",
    supportEmail: "support@example.com",
    supportPhone: "555-555-5555",
  });
  assert.match(html, /INFINITI · Q30 · Yellow/);
  assert.match(html, /ABCD 123/);
  assert.match(html, /cid:parking-spot-22/);
  assert.match(html, /7:20 a\.m\./);
});

test("Renter uses the same signature logo as Host without changing reservation details", async () => {
  const { readFile } = await import("node:fs/promises");
  const template = await readFile(new URL("../api/emails/templates/_parking-confirmation.template.js", import.meta.url), "utf8");
  assert.match(template, /\[BOOKING_LOGO_URL\]/);
  assert.doesNotMatch(template, /https:\/\/www\.myparkshare\.ca\/email\/logo\.png/);
  assert.match(template, /BOOKING\/CONFIRMED|BOOKING CONFIRMED|confirmation-headline\.png/);
  assert.match(template, /ParkShare_Parker_04_ParkShare_App\.png/);

  const details = {
    renterName: "Sample Driver", hostName: "Sample Host", address: "12 Example Crescent",
    locationId: "14", spotLabel: "B", confirmationNumber: "PK-22",
    startDateLabel: "Today", startTimeStr: "7:36 p.m.", entryDateFull: "Fri, October 9, 2026",
    endTimeStr: "8:36 p.m.", exitDateFull: "Fri, October 9, 2026",
    spotImageCid: "parking-spot-22", vehicleSummary: "Lexus LC · Orange",
    vehiclePlate: "DEMO 123", directionsUrl: "https://www.myparkshare.ca/parking",
    manageReservationUrl: "https://www.myparkshare.ca/my-bookings",
  };
  const email = confirmationEmailHtml({ ...details, logoCid: "parkshare-signature-logo-22" });
  assert.match(email, /src="cid:parkshare-signature-logo-22"/);
  assert.match(email, /width="260"/);
  assert.match(email, /cid:parking-spot-22/);
  assert.match(email, /Lexus LC · Orange/);
  assert.match(email, /7:36 p\.m\./);
  assert.match(email, /8:36 p\.m\./);
  assert.doesNotMatch(email, /\[BOOKING_LOGO_URL\]/);
  assert.doesNotMatch(email, /email\/logo\.png/);

  const webhook = await readFile(new URL("../api/stripe-webhook.js", import.meta.url), "utf8");
  assert.match(webhook, /const logoBuffer = await renderHostLogoPng\(\)/);
  assert.match(webhook, /content_id: hostLogoCid/);
  assert.match(webhook, /attachments: bookingAttachments/);
  assert.match(webhook, /logoCid: hostLogoCid/);
  assert.match(webhook, /attachments: hostAttachments/);
});
