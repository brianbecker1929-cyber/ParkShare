// GET /api/public-parking — privacy-safe listing discovery.
// This endpoint is a candidate replacement for direct public Supabase reads.
// IMPORTANT: it is not wired to the UI until all consumers are migrated.
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
    const listings = (data || []).map(publicDiscoveryListing).filter(Boolean);
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({ listings, locationPrecision: "approximate" });
  } catch (error) {
    console.error("[public-parking] read failed", { code: error?.code });
    return res.status(503).json({ error: "Parking search is temporarily unavailable." });
  }
}
