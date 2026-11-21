// Identical public projection for signed-in and anonymous browsers.
import { supabaseAdmin, jsonMethod } from "./_lib.js";
import { PUBLIC_DISCOVERY_COLUMNS, publicDiscoveryListing } from "../src/lib/publicDiscovery.js";
import { publicListingBookability } from './_listing-bookability.js';
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
    const page = rows.slice(0, PAGE_SIZE);
    // The bounded RPC retains review aggregates and pagination. A lightweight
    // service-side lookup supplies the owner-approved exact listing locations.
    // Neither query sends raw photos, Host profiles or private notes to visitors.
    let details = [];
    if (page.length) {
      const result = await supabaseAdmin.from('listings').select(PUBLIC_DISCOVERY_COLUMNS).in('id', page.map(row => row.id));
      if (result.error || !Array.isArray(result.data)) throw result.error || new Error('Listing details unavailable');
      details = result.data;
    }
    const byId = new Map(details.map(row => [Number(row.id), row]));
    const statuses = await publicListingBookability(supabaseAdmin, page.map(row => row.id));
    const listings = page.filter(row => byId.has(Number(row.id))).map(l => publicDiscoveryListing({...l, ...byId.get(Number(l.id)), bookingStatus: statuses.get(Number(l.id))})).filter(Boolean);
    const nextCursor = rows.length > PAGE_SIZE ? String(rows[PAGE_SIZE - 1].id) : null;
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({ listings, nextCursor, locationPrecision: "exact" });
  } catch (error) {
    console.error("[public-parking] discovery unavailable", { code: error?.code });
    return res.status(503).json({ error: "Parking search is temporarily unavailable." });
  }
}
