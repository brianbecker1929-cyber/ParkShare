// Anonymous GET /api/public-parking. Never forward raw Supabase records.
import { supabaseAdmin, jsonMethod } from "./_lib.js";
import { PUBLIC_DISCOVERY_COLUMNS, publicDiscoveryListing } from "../src/lib/publicDiscovery.js";

export default async function handler(req, res) {
  if (!jsonMethod(req, res, "GET")) return;
  try {
    const { data, error } = await supabaseAdmin.from("listings")
      .select(PUBLIC_DISCOVERY_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const ids = (data || []).map(l => l.id);
    let reviewRows = [];
    if (ids.length) {
      const result = await supabaseAdmin.from("reviews")
        .select("listing_id,rating").in("listing_id", ids);
      if (result.error) throw result.error;
      reviewRows = result.data || [];
    }
    const byListing = new Map();
    for (const rating of reviewRows) {
      const entries = byListing.get(Number(rating.listing_id)) || [];
      entries.push({ rating: rating.rating });
      byListing.set(Number(rating.listing_id), entries);
    }
    const listings = (data || []).map(l => publicDiscoveryListing(l, byListing.get(Number(l.id)) || [])).filter(Boolean);
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({ listings, locationPrecision: "approximate" });
  } catch (error) {
    console.error("[public-parking] discovery unavailable", { code: error?.code });
    return res.status(503).json({ error: "Parking search is temporarily unavailable." });
  }
}
