// Convert the approved website wordmark to an email-safe PNG at send time.
// Inline CID embedding avoids cross-domain image blocks on preview deployments
// and keeps actual Host emails independent from image CDN/proxy behaviour.
import sharp from "sharp";
import { readFileSync } from "node:fs";
import path from "node:path";

const APPROVED_LOGO = path.join(process.cwd(), "public", "brand", "parkshare-william-parker-logo.webp");

export async function renderHostLogoPng() {
  const original = readFileSync(APPROVED_LOGO);
  return sharp(original)
    .resize({ width: 900, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
}


// Email-ready waist-up William, derived from the existing approved mascot.
// Crop the transparent source before rendering, not with CSS overflow/position:
// several email clients ignore those properties. A tightly trimmed PNG lets
// the visible bottom of William meet the navy booking-status banner exactly.
const APPROVED_WILLIAM = path.join(process.cwd(), "public", "william-v3", "masters", "ParkShare_William_05_Presenting.png");

export async function renderHostPortraitPng() {
  const original = readFileSync(APPROVED_WILLIAM);
  const trimmed = await sharp(original)
    .trim({ threshold: 12 })
    .ensureAlpha()
    .png()
    .toBuffer();
  const { width, height } = await sharp(trimmed).metadata();
  if (!width || !height) throw new Error("Approved William mascot could not be trimmed");

  // Approved hero treatment: William is scaled UP while his head stays in
  // place. The crop ends immediately below the yellow belt at the waist
  // (about 55.5% of the tightly trimmed master); NO legs or hips remain.
  // The following navy email banner masks the continuation of his body with
  // one straight uninterrupted edge, without CSS clipping or positioning.
  const waistHeight = Math.max(1, Math.min(height, Math.round(height * 0.555)));
  return sharp(trimmed)
    .extract({ left: 0, top: 0, width, height: waistHeight })
    .resize({ width: 460, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
