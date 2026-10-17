import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseListingCoverSource } from "../api/_listing-cover.js";
import { isListingImageUrl } from "../src/lib/listingPhotos.js";

test("public parking query does not return Base64 covers or photo arrays", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const segment = app.slice(app.indexOf("function useAllListings()"), app.indexOf("//", app.indexOf("function useAllListings()") + 100));
  assert.match(segment, /\.select\("id, title, address, price, spaces, features, description, lat, lng, spots, availability, created_at, profiles\(name\), reviews\(rating\)"\)/);
  assert.doesNotMatch(segment, /\.select\("\*, profiles\(name\), reviews\(rating\)"\)/);
  assert.match(app, /img: `\/api\/listing-cover\?listingId=\$\{row\.id\}`/);
  assert.match(app, /loading="lazy" decoding="async"/);
});

test("legacy Base64 JPEG is parsed into bytes only for one cover request", () => {
  const src = "data:image/jpeg;base64," + Buffer.from([0xff,0xd8,0xff,0xd9]).toString("base64");
  const image = parseListingCoverSource(src);
  assert.equal(image.kind, "bytes");
  assert.equal(image.mime, "image/jpeg");
  assert.deepEqual(image.bytes, Buffer.from([0xff,0xd8,0xff,0xd9]));
});

test("public Storage cover redirects must remain on the approved Supabase origin", () => {
  const supabase = "https://biydlfekindgaslgktsx.supabase.co";
  const valid = supabase + "/storage/v1/object/public/listing-photos/uuid/image.webp";
  assert.deepEqual(parseListingCoverSource(valid, supabase), {kind:"redirect",url:valid});
  assert.equal(parseListingCoverSource("https://evil.example/storage/v1/object/public/listing-photos/p.png", supabase).kind, "missing");
  assert.equal(parseListingCoverSource("https://biydlfekindgaslgktsx.supabase.co.evil.example/storage/v1/object/public/listing-photos/p.png", supabase).kind, "missing");
  assert.equal(parseListingCoverSource("javascript:alert(1)", supabase).kind, "missing");
});

test("oversized image and unsupported data type are denied", () => {
  const tooBig = "data:image/png;base64," + Buffer.alloc(10 * 1024 * 1024 + 1, 0).toString("base64");
  assert.equal(parseListingCoverSource(tooBig).kind, "too-large");
  assert.equal(parseListingCoverSource("data:text/html;base64,PGgxPjwvaDE+").kind, "missing");
});

test("approved internal cover URL is rendered as image; malformed URLs are not", () => {
  assert.equal(isListingImageUrl("/api/listing-cover?listingId=123"), true);
  assert.equal(isListingImageUrl("/api/listing-cover?listingId=bad"), false);
  assert.equal(isListingImageUrl("data:image/jpeg;base64,AAECAw=="), true);
});
