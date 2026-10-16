// GET /api/listing-cover?listingId=123
//
// Lightweight, CDN-cacheable cover for existing Base64 database photographs.
// Do not send Base64 image fields in the main /parking listing JSON.
// Newly uploaded Storage photographs redirect only to our own public bucket.
// Reads one listing on demand; never changes listing or photo records.

import sharp from "sharp";
import { supabaseAdmin, jsonMethod } from "./_lib.js";
import { embeddedPhotoData, trustedListingStorageUrl } from "../src/lib/publicListings.js";

const MAX_LEGACY_IMAGE_BYTES = 10 * 1024 * 1024;

export default async function handler(req, res) {
  if (!jsonMethod(req, res, "GET")) return;
  const rawId = req.query?.listingId;
  const id = Number(rawId);
  if (!/^[1-9]\d*$/.test(String(rawId ?? "")) || !Number.isSafeInteger(id)) {
    return res.status(400).json({ error: "Invalid listing ID." });
  }

  try {
    const { data: listing, error } = await supabaseAdmin
      .from("listings")
      .select("id,img")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!listing?.img) return res.status(404).end();

    // New photos live in the public Storage bucket. Never redirect to
    // arbitrary Host-controlled URLs or different projects/domains.
    const redirectUrl = trustedListingStorageUrl(
      listing.img, process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    );
    if (redirectUrl) {
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
      res.setHeader("Location", redirectUrl);
      return res.status(302).end();
    }

    const embedded = embeddedPhotoData(listing.img);
    if (!embedded) return res.status(404).end();

    // Avoid large serverless responses and cache a small photo instead.
    const buffer = Buffer.from(embedded.base64, "base64");
    if (!buffer.length || buffer.length > MAX_LEGACY_IMAGE_BYTES) {
      return res.status(413).end();
    }
    const thumb = await sharp(buffer, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75, effort: 3 })
      .toBuffer();

    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Content-Length", String(thumb.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).send(thumb);
  } catch (error) {
    console.error("[listing-cover] Cover fetch/transform failed", { listingId: id, code: error?.code });
    return res.status(503).json({ error: "Listing photograph temporarily unavailable." });
  }
}
