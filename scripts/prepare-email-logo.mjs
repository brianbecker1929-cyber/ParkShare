// Produce an email-client-compatible PNG from the exact logo used by the
// website header and footer. This runs before Vite's production build so
// public/email/parkshare-signature-logo.png is served by Vercel as a static
// asset. Keep the website's approved WebP unchanged.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const source = path.resolve("public/brand/parkshare-william-parker-logo.webp");
const target = path.resolve("public/email/parkshare-signature-logo.png");

await mkdir(path.dirname(target), { recursive: true });
await sharp(source)
  .resize({ width: 900, withoutEnlargement: true })
  .png({ compressionLevel: 9, effort: 7 })
  .toFile(target);

const info = await sharp(target).metadata();
if (info.format !== "png" || !info.width || !info.height) {
  throw new Error("Failed to generate ParkShare's email-safe signature logo");
}
console.log(`Created approved ParkShare email logo: ${info.width} × ${info.height}`);
