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
