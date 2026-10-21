// Recreates the same "Your Parking Spot" diagram shown in the app's
// booking flow (SpotPicker in src/App.jsx), server-side, using real data
// for this specific booking — NOT a screenshot. The visual graphic itself
// (garage, driveway, grass) is the same static public/driveway-template.png
// used everywhere else in the app; this draws the listing's physical bays
// exactly where the frontend positions them, so the two never look
// noticeably different.
//
// IMPORTANT: the box positions below (computeEmailSpotBoxes) are copied math from
// DRIVEWAY_PAVEMENT / SpotPicker in src/App.jsx. If that layout is ever
// changed, this needs to be updated to match, or the email's diagram will
// drift out of sync with what the app actually shows.
//
// Requires the "sharp" package (added to package.json).

import sharp from "sharp";
import { readFileSync } from "fs";
import path from "path";
import { hasDrivewayVehicle } from "../src/lib/drivewayCar.js";
import { premiumVehicleBuffer } from "./_premium-vehicle.js";
import { getListingSpotLayout } from "../src/lib/listingSpotLayout.js";

const TEMPLATE_PATH = path.join(process.cwd(), "public", "driveway-template.png");
const IMG_W = 1065;
const IMG_H = 1477;

const COLORS = {
  navy: "#1C2B39",
  moss: "#3F7A5E",
  hazard: "#E2571C",
  muted: "#71695A",
};

export function computeEmailSpotBoxes(count) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 8) return [];
  const pavTop = 0.16 * IMG_H;
  const pavLeft = 0.23 * IMG_W;
  const pavRight = 0.76 * IMG_W;
  const pavBottom = 0.82 * IMG_H;
  const pavW = pavRight - pavLeft;
  const pavH = pavBottom - pavTop;

  // CSS % padding is relative to the containing block's WIDTH, even for
  // top/bottom — matching DrivewayFrame's `padding: "3% 4%"` exactly.
  const padV = 0.03 * pavW;
  const padH = 0.04 * pavW;

  const innerLeft = pavLeft + padH;
  const innerTop = pavTop + padV;
  const innerW = pavW - 2 * padH;
  const innerH = pavH - 2 * padV;

  const gridW = 0.86 * innerW;
  const gridH = 0.90 * innerH;
  const gridLeft = innerLeft + (innerW - gridW) / 2;
  const gridTop = innerTop + (innerH - gridH) / 2;

  const colGap = 0.03 * gridW;
  const rowGap = 0.03 * gridH;
  const columns = count === 1 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const cellW = (gridW - colGap * (columns - 1)) / columns;
  const cellH = (gridH - rowGap * (rows - 1)) / rows;

  const boxes = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / columns), col = i % columns;
    boxes.push({
      label: String.fromCharCode(65 + i),
      x: gridLeft + col * (cellW + colGap),
      y: gridTop + row * (cellH + rowGap),
      w: cellW,
      h: cellH,
    });
  }
  return boxes;
}

// A small font rendered as SVG paths instead of font-dependent <text> nodes.
// Sharp/Vercel serverless environments may not include Arial; without this,
// the emailed diagram can show replacement squares instead of spot labels.
// 5x7 glyphs remain legible even in the 300px-wide email preview.
const GLYPHS = {
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
  A: ["01110","10001","10001","11111","10001","10001","10001"],
  B: ["11110","10001","10001","11110","10001","10001","11110"],
  C: ["01111","10000","10000","10000","10000","10000","01111"],
  D: ["11110","10001","10001","10001","10001","10001","11110"],
  E: ["11111","10000","10000","11110","10000","10000","11111"],
  F: ["11111","10000","10000","11110","10000","10000","10000"],
  G: ["01111","10000","10000","10111","10001","10001","01111"],
  H: ["10001","10001","10001","11111","10001","10001","10001"],
  I: ["11111","00100","00100","00100","00100","00100","11111"],
  J: ["00111","00010","00010","00010","10010","10010","01100"],
  K: ["10001","10010","10100","11000","10100","10010","10001"],
  L: ["10000","10000","10000","10000","10000","10000","11111"],
  M: ["10001","11011","10101","10101","10001","10001","10001"],
  N: ["10001","11001","10101","10011","10001","10001","10001"],
  O: ["01110","10001","10001","10001","10001","10001","01110"],
  P: ["11110","10001","10001","11110","10000","10000","10000"],
  Q: ["01110","10001","10001","10001","10101","10010","01101"],
  R: ["11110","10001","10001","11110","10100","10010","10001"],
  S: ["01111","10000","10000","01110","00001","00001","11110"],
  T: ["11111","00100","00100","00100","00100","00100","00100"],
  U: ["10001","10001","10001","10001","10001","10001","01110"],
  V: ["10001","10001","10001","10001","10001","01010","00100"],
  W: ["10001","10001","10001","10101","10101","10101","01010"],
  X: ["10001","10001","01010","00100","01010","10001","10001"],
  Y: ["10001","10001","01010","00100","00100","00100","00100"],
  Z: ["11111","00001","00010","00100","01000","10000","11111"],
};

function pixelLabel(text, centerX, y, pixelSize, color) {
  const glyphs = String(text).toUpperCase().split("");
  const width = (glyphs.length * 6 - 1) * pixelSize;
  const left = centerX - width / 2;
  const paths = [];
  glyphs.forEach((letter, index) => {
    (GLYPHS[letter] || GLYPHS[" "]).forEach((line, row) => {
      for (let col = 0; col < line.length; col++) {
        if (line[col] === "1") {
          const x = left + (index * 6 + col) * pixelSize;
          const yy = y + row * pixelSize;
          paths.push(`M${x} ${yy}h${pixelSize}v${pixelSize}h-${pixelSize}Z`);
        }
      }
    });
  });
  return `<path fill="${color}" d="${paths.join(" ")}"/>`;
}

// The number of rental spots is not a physical spot index. If the host made
// Spot B rentable and Spot A private, a capacity of 1 MUST NOT label A open.
export function deriveEmailSpotStates(listing = {}) {
  return getListingSpotLayout(listing).map(spot => spot.forRent);
}

/**
 * @param {boolean[]} spotStates - 1-8 booleans from deriveEmailSpotStates(),
 *   respecting the Host's configured rentable bays and this booking's spot.
 * @param {number|null} chosenIndex - 0-7, which physical bay this booking picked.
 * @param {object|null} vehicle - Stripe-confirmed vehicle snapshot, including colour.
 * @returns {Promise<Buffer>} PNG image buffer.
 */
export async function renderParkingSpotImage(spotStates, chosenIndex, vehicle = null) {
  const boxes = computeEmailSpotBoxes(Array.isArray(spotStates) ? spotStates.length : 0);
  // Unknown/changed legacy layouts must use the existing text fallback,
  // rather than inventing bays or highlighting a different physical spot.
  if (!boxes.length || !Number.isInteger(chosenIndex) || !boxes[chosenIndex]) {
    throw new Error("Booking spot is not present in the listing layout");
  }

  const rects = boxes.map((b, i) => {
    const isChosen = chosenIndex === i;
    const isAvailable = spotStates ? !!spotStates[i] : true;
    const fill = isChosen ? "#E9F2ED" : isAvailable ? "#F7F3E7" : "#EAE6DA";
    const stroke = isChosen ? COLORS.hazard : isAvailable ? COLORS.moss : "#B0AA9C";
    const strokeWidth = isChosen ? 10 : 4;
    const cx = b.x + b.w / 2;
    // Keep every selected A-H label inside the orange outline, with the
    // same left nudge as the website. The car has the remaining bay height.
    const label = pixelLabel(`SPOT ${b.label}`, cx - (isChosen ? 4 : 0), b.y + b.h * (isChosen ? 0.055 : 0.16), isChosen ? Math.min(3.7, b.h * .01) : Math.min(4.2, b.h * .014), COLORS.navy);
    const status = isChosen
      ? ""
      : isAvailable
        ? pixelLabel("FOR RENT", cx, b.y + b.h * 0.83, Math.min(2.9, b.h * .009), COLORS.moss)
        : pixelLabel("NOT FOR", cx, b.y + b.h * 0.78, Math.min(3.2, b.h * .009), COLORS.muted)
          + pixelLabel("RENT", cx, b.y + b.h * 0.85, Math.min(3.2, b.h * .009), COLORS.muted);

    // The actual PNG/WebP vehicle asset is composited AFTER the spot labels.
    // No footer inside the selected bay, matching the approved spot picker.
    const symbol = isChosen && hasDrivewayVehicle(vehicle)
      ? ""
      : isAvailable
        ? `<g><circle cx="${cx}" cy="${b.y + b.h * 0.58}" r="${Math.min(19, b.h * .05)}" fill="${COLORS.moss}" opacity=".88"/>${pixelLabel("P", cx, b.y + b.h * 0.58 - Math.min(12, b.h * .03), Math.min(3.6, b.h * .009), "#FFFFFF")}</g>`
        : `<g fill="none" stroke="#B6AFA3" stroke-width="${Math.min(7, b.h * .02)}" stroke-linecap="round"><circle cx="${cx}" cy="${b.y + b.h * 0.58}" r="${Math.min(25, b.h * .07)}"/><path d="M${cx - Math.min(16, b.h * .045)} ${b.y + b.h * 0.58 - Math.min(16, b.h * .045)}L${cx + Math.min(16, b.h * .045)} ${b.y + b.h * 0.58 + Math.min(16, b.h * .045)}"/></g>`;

    return `
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />
      ${label}
      ${symbol}
      ${status}
    `;
  }).join("\n");

  const svg = `<svg width="${IMG_W}" height="${IMG_H}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;

  const templateBuffer = readFileSync(TEMPLATE_PATH);
  // Two separate sharp calls, not chained — chaining .resize() directly
  // after .composite() causes sharp/libvips to rasterize the SVG overlay at
  // a slightly different pixel density than the base image (an off-by-a-
  // pixel mismatch), which throws "Image to composite must have same
  // dimensions or smaller." Doing the resize as a fully separate pipeline
  // on the already-composited buffer avoids that interaction entirely.
  const composited = await sharp(templateBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();

  let withCar = composited;
  const booked = Number.isInteger(chosenIndex) ? boxes[chosenIndex] : null;
  if (booked && hasDrivewayVehicle(vehicle)) {
    // Reuse the website's tightly cropped detailed body/colour artwork.
    // Label occupies the top band; car fills the rest with a clean margin.
    const carWidth = Math.max(1, Math.round(booked.w * .96));
    const carHeight = Math.max(1, Math.round(booked.h * .83));
    const carX = Math.round(booked.x + (booked.w - carWidth) / 2);
    const carY = Math.round(booked.y + booked.h * .13);
    const photo = await sharp(await premiumVehicleBuffer(vehicle))
      .resize(carWidth, carHeight, { fit: "contain", background: "#00000000" })
      .png()
      .toBuffer();
    withCar = await sharp(composited)
      .composite([{ input: photo, top: carY, left: carX }])
      .png()
      .toBuffer();
  }

  return sharp(withCar)
    .resize(1000) // >2x the displayed 420px width for crisp email/retina detail
    .png({ compressionLevel: 9 })
    .toBuffer();
}
