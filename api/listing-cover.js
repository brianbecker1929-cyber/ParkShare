// Public Driveway cover. One narrow query per image avoids the public
// /parking search response embedding every legacy Base64 image. This endpoint
// intentionally permits unauthenticated read of a *public listing's* cover.
import { supabaseAdmin } from "./_lib.js";
import { parseListingCoverSource } from "./_listing-cover.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end();
  }
  const listingId = Number(req.query?.listingId);
  if (!Number.isSafeInteger(listingId) || listingId <= 0) {
    return res.status(400).json({ error: "Invalid listing ID" });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("listings")
      .select("img")
      .eq("id", listingId)
      .maybeSingle();
    if (error) {
      console.error("[listing-cover] Failed reading listing cover", { listingId, code: error.code, message: error.message });
      return res.status(503).json({ error: "Image temporarily unavailable" });
    }
    if (!data) return res.status(404).end();

    const result = parseListingCoverSource(data.img, process.env.SUPABASE_URL);
    if (result.kind === "redirect") {
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
      res.setHeader("Location", result.url);
      return res.status(302).end();
    }
    if (result.kind === "too-large") return res.status(413).end();
    if (result.kind !== "bytes") return res.status(404).end();

    res.setHeader("Content-Type", result.mime);
    res.setHeader("Content-Length", String(result.bytes.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200);
    return res.end(req.method === "HEAD" ? undefined : result.bytes);
  } catch (error) {
    console.error("[listing-cover] Unexpected error", { listingId, message: error?.message });
    return res.status(503).json({ error: "Image temporarily unavailable" });
  }
}
