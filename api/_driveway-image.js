// Recreates the same "Your Parking Spot" diagram shown in the app's
// booking flow (SpotPicker in src/App.jsx), server-side, using real data
// for this specific booking — NOT a screenshot. The visual graphic itself
// (garage, driveway, grass) is the same static public/driveway-template.png
// used everywhere else in the app; this draws the 4 spot boxes on top of it
// exactly where the frontend positions them, so the two never look
// noticeably different.
//
// IMPORTANT: the box positions below (computeBoxes) are copied math from
// DRIVEWAY_PAVEMENT / SpotPicker in src/App.jsx. If that layout is ever
// changed, this needs to be updated to match, or the email's diagram will
// drift out of sync with what the app actually shows.
//
// Requires the "sharp" package (added to package.json).

import sharp from "sharp";
import { readFileSync } from "fs";
import path from "path";

const TEMPLATE_PATH = path.join(process.cwd(), "public", "driveway-template.png");
const IMG_W = 1065;
const IMG_H = 1477;

const COLORS = {
  navy: "#1C2B39",
  moss: "#3F7A5E",
  hazard: "#E2571C",
  muted: "#71695A",
};

function computeBoxes() {
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
  const cellW = (gridW - colGap) / 2;
  const cellH = (gridH - rowGap) / 2;

  const labels = ["A", "B", "C", "D"];
  const boxes = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const i = row * 2 + col;
      boxes.push({
        label: labels[i],
        x: gridLeft + col * (cellW + colGap),
        y: gridTop + row * (cellH + rowGap),
        w: cellW,
        h: cellH,
      });
    }
  }
  return boxes;
}

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * @param {boolean[]} spotStates - 4 booleans, is-this-spot-for-rent. Since
 *   there's no real per-spot "for rent" data in the schema (only a total
 *   `spaces` count), callers should derive this the same way the frontend
 *   does: `[0,1,2,3].map(i => i < spaces)`.
 * @param {number|null} chosenIndex - 0-3, which spot this booking picked.
 * @returns {Promise<Buffer>} PNG image buffer.
 */
export async function renderParkingSpotImage(spotStates, chosenIndex) {
  const boxes = computeBoxes();

  const rects = boxes.map((b, i) => {
    const isChosen = chosenIndex === i;
    const isAvailable = spotStates ? !!spotStates[i] : true;
    const fill = isChosen ? "#E9F2ED" : isAvailable ? "#F7F3E7" : "#EAE6DA";
    const stroke = isChosen ? COLORS.hazard : isAvailable ? COLORS.moss : "#B0AA9C";
    const strokeWidth = isChosen ? 6 : 4;
    const statusText = isChosen ? "Your spot" : isAvailable ? "Available" : "Not for rent";
    const statusColor = isChosen ? COLORS.hazard : isAvailable ? COLORS.moss : COLORS.muted;
    const cx = b.x + b.w / 2;
    const labelY = b.y + b.h * 0.38;
    const iconY = b.y + b.h * 0.58;
    const statusY = b.y + b.h * 0.85;

    // Simple vector glyphs instead of emoji/icon fonts, which don't
    // reliably render in server-side SVG-to-PNG compositing.
    const glyph = isAvailable
      ? `<rect x="${cx - 26}" y="${iconY - 14}" width="52" height="28" rx="9" fill="${statusColor}" opacity="0.85" />`
      : `<g stroke="${COLORS.muted}" stroke-width="6" stroke-linecap="round" opacity="0.55">
           <line x1="${cx - 18}" y1="${iconY - 18}" x2="${cx + 18}" y2="${iconY + 18}" />
           <line x1="${cx + 18}" y1="${iconY - 18}" x2="${cx - 18}" y2="${iconY + 18}" />
         </g>`;

    return `
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />
      <text x="${cx}" y="${labelY}" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${Math.round(b.h * 0.12)}" fill="${COLORS.navy}" text-anchor="middle">Spot ${b.label}</text>
      ${glyph}
      <text x="${cx}" y="${statusY}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${Math.round(b.h * 0.075)}" fill="${statusColor}" text-anchor="middle">${escapeXml(statusText)}</text>
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

  return sharp(composited)
    .resize(500) // email-appropriate width, keeps the template's aspect ratio
    .png({ quality: 85 })
    .toBuffer();
}
