// BUG-005161 — Stream one cover image at a time rather than embedding
// every listing's multi-megabyte Base64 data in the public parking search.
// Public listing photographs are already public content.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function parseListingCoverSource(source, supabaseUrl = "") {
  if (typeof source !== "string" || !source) return { kind: "missing" };
  const imageMatch = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(source);
  if (imageMatch) {
    const mime = imageMatch[1].toLowerCase();
    if (!IMAGE_TYPES.has(mime)) return { kind: "missing" };
    // Check encoded length before allocating the Buffer; Base64 adds ~33%.
    if (imageMatch[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) return { kind: "too-large" };
    const bytes = Buffer.from(imageMatch[2], "base64");
    if (bytes.length > MAX_IMAGE_BYTES || bytes.length === 0) return { kind: "too-large" };
    return { kind: "bytes", mime, bytes };
  }
  if (source.startsWith("https://") && supabaseUrl) {
    try {
      const publicOrigin = new URL(supabaseUrl).origin;
      const url = new URL(source);
      if (url.origin === publicOrigin
        && url.pathname.startsWith("/storage/v1/object/public/listing-photos/")
        && !url.username && !url.password) return { kind: "redirect", url: url.href };
    } catch { /* no external redirects */ }
  }
  return { kind: "missing" };
}
