import test from "node:test";
import assert from "node:assert/strict";
import {
  LISTING_PHOTO_BUCKET,
  MAX_LISTING_PHOTO_BYTES,
  validateListingPhoto,
  isListingImageUrl,
  listingPhotoPath,
  uploadListingPhotos,
} from "../src/lib/listingPhotos.js";

const HOST = "00000000-0000-4000-8000-000000000271";
const UUID = "10000000-0000-4000-8000-000000000001";
const file = (bytes, type = "image/jpeg") => ({ size: bytes, type, name: "driveway.jpg" });

function mockedStorage({ failAt = 0 } = {}) {
  const paths = [];
  const removed = [];
  const storage = {
    upload: async (path, value, options) => {
      paths.push({ path, value, options });
      return { error: failAt === paths.length ? { message: "Network interrupted" } : null };
    },
    getPublicUrl: path => ({ data: { publicUrl: `https://qa.supabase.co/storage/v1/object/public/listing-photos/${path}` } }),
    remove: async names => { removed.push(...names); return { error: null }; },
  };
  return { client: { storage: { from: bucket => { assert.equal(bucket, LISTING_PHOTO_BUCKET); return storage; } } }, paths, removed };
}

test("accepts large JPEGs without Base64 conversion and rejects oversized files", () => {
  assert.equal(validateListingPhoto(file(7_500_000)), null);
  assert.equal(validateListingPhoto(file(MAX_LISTING_PHOTO_BYTES + 1)), "Photo exceeds the 10 MB limit. Choose a smaller image.");
  assert.match(validateListingPhoto(file(100, "image/heic")), /Unsupported photo format/);
  assert.equal(validateListingPhoto(file(0)), "The selected photo is empty.");
});

test("photo object paths are scoped to one Host account and unique", () => {
  assert.equal(listingPhotoPath(HOST, file(6_500_000), UUID), `${HOST}/${UUID}.jpg`);
  assert.throws(() => listingPhotoPath("not-a-host", file(100), UUID), /valid Host/);
});

test("uploads six-megabyte photos as Files and returns only public URL references", async () => {
  const fixture = mockedStorage();
  const events = [];
  {
    const data = await uploadListingPhotos(fixture.client, HOST, [{ file: file(6_500_000) }],
      (current, total) => events.push([current, total]), () => UUID);
    assert.equal(data.paths.length, 1);
    assert.equal(data.urls.length, 1);
    assert.equal(data.urls[0].startsWith("https://"), true);
    assert.deepEqual(events, [[1, 1]]);
    assert.equal(fixture.paths[0].value.size, 6_500_000);
    assert.equal(fixture.paths[0].options.contentType, "image/jpeg");
    assert.equal(fixture.paths[0].options.upsert, false);
    assert.deepEqual(fixture.removed, []);
  }
});

test("cleans up prior images when the next upload fails", async () => {
  const fixture = mockedStorage({ failAt: 2 });
  let counter = 0;
  {
    await assert.rejects(() => uploadListingPhotos(fixture.client, HOST, [
      { file: file(5_000_000) }, { file: file(5_000_000) },
    ], () => {}, () => "10000000-0000-4000-8000-" + String(++counter).padStart(12, "0")), /Photo 2 couldn't upload/);
    assert.equal(fixture.removed.length, 1);
    assert.equal(fixture.removed[0], fixture.paths[0].path);
  }
});

test("rejects attempts to upload missing or more than six photos", async () => {
  const fixture = mockedStorage();
  await assert.rejects(() => uploadListingPhotos(fixture.client, HOST, []), /between one and six/);
  await assert.rejects(() => uploadListingPhotos(fixture.client, HOST, Array(7).fill({ file: file(5000) })), /between one and six/);
  assert.equal(fixture.paths.length, 0);
});

test("listing thumbnails treat HTTPS Storage references and legacy Base64 as images", async () => {
  assert.equal(isListingImageUrl("https://qa.supabase.co/storage/v1/object/public/listing-photos/id/photo.webp"), true);
  assert.equal(isListingImageUrl("data:image/jpeg;base64,AAECAw=="), true);
  assert.equal(isListingImageUrl("data:image/png;base64,AAECAw=="), true);
  assert.equal(isListingImageUrl("https://"), false);
  assert.equal(isListingImageUrl("javascript:alert(1)"), false);
  assert.equal(isListingImageUrl("🏠"), false);
  assert.equal(isListingImageUrl(null), false);
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /const isPhoto = isListingImageUrl\(listing\.img\);/);
  assert.match(app, /isListingImageUrl\(listing\.img\) && \(/);
});
