// Anonymous review summaries deliberately contain no reviewer IDs, profile
// fields, or user-provided free-text that can disclose a residential address.
import { supabaseAdmin, jsonMethod } from "./_lib.js";
import { validId } from "../src/lib/privateListingAccess.js";

export default async function handler(req, res) {
  if (!jsonMethod(req, res, "GET")) return;
  const listingId = validId(req.query?.listingId);
  if (!listingId) return res.status(400).json({ error: "Invalid listing ID." });
  try {
    const { data, error } = await supabaseAdmin.from("reviews")
      .select("rating,created_at").eq("listing_id", listingId)
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=180");
    return res.status(200).json({ reviews: (data || []).map(r => ({
      user: "ParkShare driver", rating: r.rating,
      date: r.created_at ? new Date(r.created_at).toLocaleDateString("en-CA", { year: "numeric", month: "short", timeZone: "UTC" }) : "",
      text: "",
    })) });
  } catch (err) {
    console.error("[public-reviews]", { code: err?.code });
    return res.status(503).json({ error: "Reviews are temporarily unavailable." });
  }
}
