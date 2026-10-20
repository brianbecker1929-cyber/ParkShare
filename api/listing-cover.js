// GET /api/listing-cover?listingId=123
//
// Participant-authorized private cover for historical and Storage photographs.
// Do not send Base64 image fields in the main /parking listing JSON.
// Server proxies only the listing Host's own private Storage objects.
// Reads one listing on demand; never changes listing or photo records.

import sharp from "sharp";
import { supabaseAdmin, jsonMethod, requireUser } from "./_lib.js";
import { validId, canReadPreciseLocation } from "../src/lib/privateListingAccess.js";
import { embeddedPhotoData, trustedListingStorageUrl } from "../src/lib/publicListings.js";

const MAX_LEGACY_IMAGE_BYTES = 10 * 1024 * 1024;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!jsonMethod(req, res, "GET")) return;
  const rawId = req.query?.listingId;
  const id = Number(rawId);
  if (!/^[1-9]\d*$/.test(String(rawId ?? "")) || !Number.isSafeInteger(id)) {
    return res.status(400).json({ error: "Invalid listing ID." });
  }

  // Photos can show house numbers, identifiable buildings and embedded clues.
  // No anonymous image access; return no-store for signed-in permitted users.
  const user = await requireUser(req, res);
  if (!user) return;
  const bookingId = req.query?.bookingId ? validId(req.query.bookingId) : null;
  if (req.query?.bookingId && !bookingId) return res.status(400).end();

  try {
    const { data: listing, error } = await supabaseAdmin
      .from("listings")
      .select("id,img,host_id")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!listing?.img) return res.status(404).end();
    let booking = null;
    if (bookingId && user.id !== listing.host_id) {
      const result = await supabaseAdmin.from("bookings")
        .select("renter_id,listing_id,status,paid_at,stripe_checkout_session_id")
        .eq("id",bookingId).maybeSingle();
      if (result.error) throw result.error;
      booking = result.data;
    }
    if (!canReadPreciseLocation({
      userId: user.id, hostId: listing.host_id, booking, listingId: id,
    })) return res.status(404).end();
    res.setHeader("Cache-Control", "private, no-store");

    let buffer;
    const ownStorageUrl = trustedListingStorageUrl(
      listing.img, process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    );
    if (ownStorageUrl) {
      // The listing-photos bucket will be PRIVATE under the coordinated SQL
      // migration. An authorized server downloads from Storage; do not 302
      // redirect to a directly accessible public-object URL.
      const prefix = "/storage/v1/object/public/listing-photos/";
      const encodedPath = new URL(ownStorageUrl).pathname.slice(prefix.length);
      const path = decodeURIComponent(encodedPath);
      // A Host's editable image reference cannot authorize reading another
      // Host's object through this service-role download.
      if (!path.startsWith(`${listing.host_id}/`)
          || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(path.slice(listing.host_id.length + 1))) {
        return res.status(404).end();
      }
      const result = await supabaseAdmin.storage.from("listing-photos").download(path);
      if (result.error || !result.data) return res.status(404).end();
      buffer = Buffer.from(await result.data.arrayBuffer());
    } else {
      const embedded = embeddedPhotoData(listing.img);
      if (!embedded) return res.status(404).end();
      buffer = Buffer.from(embedded.base64, "base64");
    }
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
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(thumb);
  } catch (error) {
    console.error("[listing-cover] Cover fetch/transform failed", { listingId: id, code: error?.code });
    return res.status(503).json({ error: "Listing photograph temporarily unavailable." });
  }
}
