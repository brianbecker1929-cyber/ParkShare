import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { hostBookingNotificationHtml } from "../api/_email.js";
import { renderHostLogoPng } from "../api/_host-logo.js";
import { deriveEmailSpotStates, renderParkingSpotImage } from "../api/_driveway-image.js";
import { formatBookingEmailTimes } from "../api/_booking-email-times.js";
import previewHandler from "../api/preview-host-email.js";

const vehicle = { vehicle_make: "Lexus", vehicle_model: "LC", vehicle_colour: "Orange", license_plate: "DEMO 123" };
const example = {
  hostName: "Sample Host", driverName: "Sample Driver",
  address: "12 Example Crescent, Vaughan, Ontario",
  spotLabel: "B", vehicle,
  startLabel: "Oct 9, 2026, 7:36 p.m.", endLabel: "Oct 9, 2026, 8:36 p.m.",
  bookingId: 24,
  spotImageCid: "parking-spot-24",
};

test("Host booking email has Driver-quality branding with William and host-specific information", () => {
  const html = hostBookingNotificationHtml(example);
  assert.match(html, /https:\/\/www\.myparkshare\.ca\/email\/parkshare-signature-logo\.png/);
  assert.doesNotMatch(html, /https:\/\/www\.myparkshare\.ca\/email\/logo\.png/);
  assert.match(html, /ParkShare — William and Parker with the signature wordmark/);
  assert.match(html, /width="260" style="display:block;width:260px;max-width:100%;height:auto;border:0;"/);
  assert.match(html, /padding:10px 29px;background:#1b2b3a;border-bottom:3px solid #f5a623/);
  assert.match(html, /william-v3\/masters\/ParkShare_William_05_Presenting\.png/);
  assert.match(html, /NEW BOOKING/);
  assert.match(html, /CONFIRMED!/);
  assert.match(html, /Hi <strong>Sample Host<\/strong>/);
  assert.match(html, /12 Example Crescent/);
  assert.match(html, /Sample Driver/);
  assert.match(html, /Spot B/);
  assert.match(html, /Lexus LC · Orange/);
  assert.match(html, /DEMO 123/);
  assert.match(html, /Oct 9, 2026, 7:36 p\.m\./);
  assert.match(html, /Oct 9, 2026, 8:36 p\.m\./);
  assert.match(html, /PK-24/);
  assert.match(html, /cid:parking-spot-24/);
  assert.match(html, /not confirmation that the vehicle has arrived/);
  assert.match(html, /href="https:\/\/www\.myparkshare\.ca\/host-dashboard"/);
  assert.match(html, /Open Host Dashboard/);
  assert.match(html, /eska-badge-on-navy\.png/);
  assert.match(html, /https:\/\/facebook\.com\/myparkshare/);
  assert.doesNotMatch(html, /\[[A-Z_]+\]/);
  assert.doesNotMatch(html, /href="https:\/\/www\.myparkshare\.ca\/"[^>]*>Open Host Dashboard/);
});

test("Host email escapes untrusted profile fields and renders without CID if no image exists", () => {
  const html = hostBookingNotificationHtml({
    ...example,
    hostName: "<script>alert('x')</script>",
    driverName: "Alex & Morgan",
    address: "12 <Danger> St",
    vehicle: { ...vehicle, vehicle_model: "<img src=x onerror=alert(1)>" },
    spotImageCid: null,
  });
  assert.doesNotMatch(html, /<script>|<Danger>|<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Alex &amp; Morgan/);
  assert.match(html, /Driveway preview unavailable/);
});

test("Hosted Spot B remains the single rentable spot in the diagram", () => {
  assert.deepEqual(deriveEmailSpotStates({
    spaces: 1,
    spots: [{ forRent: false }, { forRent: true }, { forRent: false }, { forRent: false }],
  }, 1), [false, true, false, false]);
  // Legacy data has no spots configuration: always include chosen spot B,
  // rather than falsely marking an unused Spot A as available.
  assert.deepEqual(deriveEmailSpotStates({ spaces: 1 }, 1), [false, true, false, false]);
  assert.deepEqual(deriveEmailSpotStates({ spaces: 2 }, 1), [true, true, false, false]);
});

test("Host email's 500px attached image is a real PNG with no font-dependent text", async () => {
  const png = await renderParkingSpotImage([false, true, false, false], 1, vehicle);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 500);
  assert.equal(metadata.format, "png");
  assert.ok(png.length > 10_000);
  const renderer = await readFile(new URL("../api/_driveway-image.js", import.meta.url), "utf8");
  assert.match(renderer, /const GLYPHS =/);
  assert.match(renderer, /function pixelLabel\(/);
  assert.doesNotMatch(renderer, /<text\s/);
});

test("October daylight saving preview is Toronto time for both Host and Driver", () => {
  const start = new Date("2026-10-09T23:36:00Z");
  const end = new Date("2026-10-10T00:36:00Z");
  const times = formatBookingEmailTimes(start, end, start);
  const html = hostBookingNotificationHtml({ ...example, startLabel: times.hostStartLabel, endLabel: times.hostEndLabel });
  assert.match(html, /7:36 p\.m\./);
  assert.match(html, /8:36 p\.m\./);
  assert.doesNotMatch(html, /11:36 p\.m\./);
});

test("non-production preview renders a synthetic email and does not send notifications", async () => {
  const previous = process.env.VERCEL_ENV;
  const mockRes = () => ({
    code: 200, headers: {}, body: "",
    status(code) { this.code = code; return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
    end(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  });
  try {
    process.env.VERCEL_ENV = "production";
    const prod = mockRes();
    await previewHandler({ method: "GET" }, prod);
    assert.equal(prod.code, 404);
    process.env.VERCEL_ENV = "preview";
    const preview = mockRes();
    await previewHandler({ method: "GET" }, preview);
    assert.equal(preview.code, 200);
    assert.match(preview.body, /SAMPLE BOOKING/);
    assert.match(preview.body, /DEMO 123/);
    const inlinePngs = preview.body.match(/data:image\/png;base64,/g) || [];
    assert.equal(inlinePngs.length, 2, "Both approved logo and driveway must render inline");
    assert.match(preview.body, /alt="ParkShare — William and Parker with the signature wordmark"/);
    assert.equal(preview.headers["X-Robots-Tag"], "noindex, nofollow");
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});

test("approved website William-and-Parker art is the source for the email-safe PNG", async () => {
  const source = new URL("../public/brand/parkshare-william-parker-logo.webp", import.meta.url);
  const metadata = await sharp(await readFile(source)).metadata();
  assert.equal(metadata.format, "webp");
  assert.ok(metadata.width > 0 && metadata.height > 0);
  const script = await readFile(new URL("../scripts/prepare-email-logo.mjs", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(script, /public\/brand\/parkshare-william-parker-logo\.webp/);
  assert.match(script, /public\/email\/parkshare-signature-logo\.png/);
  assert.match(pkg.scripts.build, /node scripts\/prepare-email-logo\.mjs && vite build/);
});

test("Host email embeds approved signature PNG via CID for reliable mail delivery", async () => {
  const png = await renderHostLogoPng();
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, "png");
  assert.ok(meta.width > 200 && meta.height > 0);
  assert.ok(png.length > 10_000);
  const email = hostBookingNotificationHtml({ ...example, logoCid: "parkshare-signature-logo-24" });
  assert.match(email, /src="cid:parkshare-signature-logo-24"/);
  assert.doesNotMatch(email, /src="https:\/\/www\.myparkshare\.ca\/email\/logo\.png"/);

  const webhook = await readFile(new URL("../api/stripe-webhook.js", import.meta.url), "utf8");
  assert.match(webhook, /const logoBuffer = await renderHostLogoPng\(\)/);
  assert.match(webhook, /content_id: hostLogoCid/);
  assert.match(webhook, /attachments: hostAttachments/);
  assert.match(webhook, /logoCid: hostLogoCid/);
});
