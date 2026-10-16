import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PUBLIC_LISTING_SELECT, embeddedPhotoData,
  publicListingCoverUrl, trustedListingStorageUrl,
} from "../src/lib/publicListings.js";

test("public search projects only lightweight listing fields (never Base64 images)", async () => {
  const names = PUBLIC_LISTING_SELECT.split(",");
  assert.ok(names.includes("id"));
  assert.ok(names.includes("title"));
  assert.ok(names.includes("spots"));
  assert.ok(names.includes("availability"));
  assert.ok(names.includes("profiles(name)"));
  assert.ok(names.includes("reviews(rating)"));
  for (const prohibited of ["*", "img", "photos", "email", "stripe_account_id"]) {
    assert.ok(!names.includes(prohibited), `Public browse must not return ${prohibited}`);
  }
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const start = app.indexOf("function useAllListings()");
  assert.ok(start > 0);
  const end = app.indexOf("function EventSubmissionForm(", start);
  const source = app.slice(start, end);
  assert.match(source, /\.select\(PUBLIC_LISTING_SELECT\)/);
  assert.doesNotMatch(source, /\.select\("\*.*profiles\(name\).*reviews\(rating\)/);
  assert.match(source, /img: publicListingCoverUrl\(row\.id\)/);
  assert.match(source, /photos: \[\]/);
});

test("cover URLs use safe identifiers and cannot be arbitrary redirects", () => {
  assert.equal(publicListingCoverUrl(25), "/api/listing-cover?listingId=25");
  assert.equal(publicListingCoverUrl(0), null);
  assert.equal(publicListingCoverUrl(-5), null);
  assert.equal(publicListingCoverUrl("1;drop"), null);
  const own = "https://biydlfekindgaslgktsx.supabase.co";
  const url = own + "/storage/v1/object/public/listing-photos/host/file.webp";
  assert.equal(trustedListingStorageUrl(url, own), url);
  for(const candidate of [
    "https://evil.example/storage/v1/object/public/listing-photos/host/file.png",
    own + "/storage/v1/object/sign/listing-photos/host/file.webp",
    "https://biydlfekindgaslgktsx.supabase.co.evil.example/storage/v1/object/public/listing-photos/x",
    own + "/storage/v1/object/public/listing-photos/f.webp?token=bogus",
    "javascript:alert(1)",
  ]) assert.equal(trustedListingStorageUrl(candidate, own), null);
});

test("only bounded JPEG/PNG/WebP Base64 data can be transformed", () => {
  const png = embeddedPhotoData("data:image/png;base64,iVBORw0KGgo=");
  assert.equal(png.mime, "image/png");
  assert.equal(png.base64, "iVBORw0KGgo=");
  assert.equal(embeddedPhotoData("data:application/pdf;base64,AA=="), null);
  assert.equal(embeddedPhotoData("data:image/png;base64,not-valid!!"), null);
  assert.equal(embeddedPhotoData("data:image/png;base64,"+"A".repeat(14*1024*1024 + 1)), null);
});

test("cover endpoint returns resized images, never redirecting to arbitrary hosts", async () => {
  const src = await readFile(new URL("../api/listing-cover.js", import.meta.url), "utf8");
  assert.match(src, /\.select\("id,img"\)/);
  assert.match(src, /trustedListingStorageUrl/);
  assert.match(src, /sharp\(buffer/);
  assert.match(src, /\.webp\(\{ quality: 75/);
  assert.match(src, /res\.status\(503\)/);
  assert.match(src, /Cache-Control/);
  assert.doesNotMatch(src, /res\.send\(listing\.img\)/);
});

test("image conversion to small WebP succeeds on representative PNG", async () => {
  const sharp = (await import("sharp")).default;
  const sample = await sharp({create:{width:1200,height:700,channels:3,background:"#F5E6C5"}}).png().toBuffer();
  const legacy = `data:image/png;base64,${sample.toString("base64")}`;
  const parsed = embeddedPhotoData(legacy);
  assert.equal(parsed.mime,"image/png");
  const thumb = await sharp(Buffer.from(parsed.base64,"base64")).resize({
    width:800,height:800,fit:"inside",withoutEnlargement:true,
  }).webp({quality:75,effort:3}).toBuffer();
  const m = await sharp(thumb).metadata();
  assert.equal(m.format,"webp");
  assert.ok(m.width <= 800 && m.height <= 800);
  assert.ok(thumb.length < sample.length);
});
