// Identical public projection for signed-in and anonymous browsers.
import { supabaseAdmin, jsonMethod } from "./_lib.js";
import { publicDiscoveryListing } from "../src/lib/publicDiscovery.js";
const PAGE_SIZE = 50;
export default async function handler(req, res) {
  if (!jsonMethod(req, res, "GET")) return;
  const cursor = req.query?.cursor;
  if (cursor !== undefined && (typeof cursor !== "string" || !/^[1-9]\d*$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) {
    return res.status(400).json({ error: "Invalid parking page." });
  }
  try {
    const { data, error } = await supabaseAdmin.rpc("public_parking_page", { p_before_id: cursor ? Number(cursor) : null });
    if (error) throw error;
    const rows = data || [];
    const listings = rows.slice(0, PAGE_SIZE).map(l => publicDiscoveryListing(l)).filter(Boolean);
    const nextCursor = rows.length > PAGE_SIZE ? String(rows[PAGE_SIZE - 1].id) : null;
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({ listings, nextCursor, locationPrecision: "approximate" });
  } catch (error) {
    console.error("[public-parking] discovery unavailable", { code: error?.code });
    return res.status(503).json({ error: "Parking search is temporarily unavailable." });
  }
}
