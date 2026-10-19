import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  canReadPreciseLocation, privateBookingListing, validId,
} from "../src/lib/privateListingAccess.js";

const paid = {
  renter_id: "driver-a", listing_id: 11,
  status: "confirmed", paid_at: "2026-10-17T11:00:00Z",
  stripe_checkout_session_id: "cs_paid",
};

test("strict IDs reject injection, malformed routes and unsafe numbers", () => {
  assert.equal(validId(42),42);
  for(const invalid of [0,-1,"01","1.5","1 OR 1=1","1e3","9999999999999999999",null]) {
    assert.equal(validId(invalid),null);
  }
});

test("unconfirmed, unpaid, cancelled and unrelated Drivers cannot read precise location", () => {
  const input={ userId:"driver-a", hostId:"host-b", listingId:11, booking:paid };
  assert.equal(canReadPreciseLocation(input),true);
  assert.equal(canReadPreciseLocation({ ...input, userId:"other-driver" }),false);
  assert.equal(canReadPreciseLocation({ ...input, booking:{ ...paid, listing_id:12 } }),false);
  assert.equal(canReadPreciseLocation({ ...input, booking:{ ...paid, status:"pending" } }),false);
  assert.equal(canReadPreciseLocation({ ...input, booking:{ ...paid, status:"refunded" } }),false);
  assert.equal(canReadPreciseLocation({ ...input, booking:{ ...paid, paid_at:null } }),false);
  assert.equal(canReadPreciseLocation({ ...input, booking:{ ...paid, stripe_checkout_session_id:null } }),false);
  assert.equal(canReadPreciseLocation({ ...input, userId:null }),false);
  assert.equal(canReadPreciseLocation({ ...input, userId:"host-b", booking:null }),true);
  assert.equal(canReadPreciseLocation({ ...input, booking:{ ...paid, status:"completed" } }),true);
});

test("non-entitled cancelled booking response contains no address, exact coordinates or Host name", () => {
  const row={ id:11, address:"123 Private Lane",title:"123 Private Lane",
    lat:43.900123,lng:-79.321234,spaces:2,spots:[{lat:43.9}],
    description:"front blue door",profiles:{name:"Private Host"} };
  const safe=privateBookingListing(row,false);
  const serialized=JSON.stringify(safe);
  for(const prohibited of ["123 Private Lane","43.900123","-79.321234","Private Host","front blue door"]) {
    assert.equal(serialized.includes(prohibited),false);
  }
  assert.equal(privateBookingListing(row,true).address,"123 Private Lane");
});

test("privacy-sensitive APIs scope private data by the JWT user and fail closed", async () => {
  const account=await readFile(new URL("../api/account-bookings.js",import.meta.url),"utf8");
  const location=await readFile(new URL("../api/private-listing-location.js",import.meta.url),"utf8");
  const messages=await readFile(new URL("../api/messages.js",import.meta.url),"utf8");
  for(const code of [account,location,messages]) assert.match(code,/requireUser\(req, res\)/);
  assert.match(account,/\.eq\("renter_id", user\.id\)/);
  assert.match(account,/\.eq\("host_id", user\.id\)/);
  assert.match(account,/privateBookingListing/);
  assert.match(location,/canReadPreciseLocation/);
  assert.match(messages,/canReadPreciseLocation/);
  assert.doesNotMatch(account,/req\.query\?.userId/);
});

test("cover endpoint requires authorization, proxies private photos and forbids public redirects", async () => {
  const image=await readFile(new URL("../api/listing-cover.js",import.meta.url),"utf8");
  assert.match(image,/requireUser\(req, res\)/);
  assert.match(image,/canReadPreciseLocation/);
  assert.match(image,/\.download\(path\)/);
  assert.doesNotMatch(image,/res\.status\(302\)/);
  assert.match(image,/Cache-Control", "private, no-store"/);
  const client=await readFile(new URL("../src/lib/privateListingPhotos.js",import.meta.url),"utf8");
  assert.match(client,/Authorization: "Bearer " \+ accessToken/);
  assert.match(client,/cache: "no-store"/);
});

test("anonymous listing reads and raw reviewer profile joins are absent from browser", async () => {
  const app=await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");
  const browse=app.slice(app.indexOf("function useAllListings()"),app.indexOf("function EventSubmissionForm("));
  assert.match(browse,/fetchPublicParkingPage\(/);
  assert.doesNotMatch(browse,/\.from\("listings"\)/);
  const reviews=app.slice(app.indexOf("function ReviewsSection("),app.indexOf("function ListingDetail("));
  assert.match(reviews,/\/api\/public-reviews/);
  assert.doesNotMatch(reviews,/\.from\("reviews"\)\s*\.select/);
});

test("migration draft removes public RLS policies and private-bucket URL access", async () => {
  const sql=await readFile(new URL("../docs/sql-proposals/bug-005183-restrict-public-data-api.sql",import.meta.url),"utf8");
  for(const legacy of ["Listings are viewable by everyone","Profiles are viewable by everyone","Reviews are viewable by everyone"]) {
    assert.ok(sql.includes('DROP POLICY IF EXISTS "'+legacy+'"'),legacy);
  }
  for(const table of ["listings","profiles","reviews"]) {
    assert.ok(sql.includes("REVOKE SELECT ON TABLE public."+table+" FROM PUBLIC, anon, authenticated;"));
  }
  assert.match(sql,/UPDATE storage\.buckets SET public = false/);
  assert.match(sql,/TO authenticated/);
  assert.doesNotMatch(sql,/GRANT SELECT ON TABLE public\.listings TO anon/);
});
