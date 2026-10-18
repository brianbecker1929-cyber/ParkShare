import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { eligibleForReview, validateReviewInput } from "../api/_review-rules.js";

const completed = {
  listing_id: 8, renter_id: "driver",
  paid_at: "2026-10-10T09:00:00.000Z",
  stripe_checkout_session_id: "cs_valid", status: "confirmed",
  booking_date: null, start_hour: null, hours: 2,
};

test("genuine past paid booking can be reviewed", () => {
  assert.equal(eligibleForReview(completed,new Date("2026-10-17T12:00:00Z")),true);
  assert.equal(eligibleForReview({...completed,status:"completed"},new Date("2026-10-17T12:00:00Z")),true);
});
test("pending, cancelled, refunded, unpaid and future bookings cannot be reviewed", () => {
  for (const status of ["pending","refunded","partially_refunded","disputed","payment_failed","cancelled"]) {
    assert.equal(eligibleForReview({...completed,status}),false,status);
  }
  assert.equal(eligibleForReview({...completed,paid_at:null}),false);
  assert.equal(eligibleForReview({...completed,stripe_checkout_session_id:null}),false);
  assert.equal(eligibleForReview(completed,new Date("2026-10-10T10:00:00Z")),false);
  assert.equal(eligibleForReview({...completed,hours:-1}),false);
});
test("ratings and review content have strict input limits",()=>{
  assert.equal(validateReviewInput({listingId:3,rating:5,text:"Great space"}),null);
  assert.ok(validateReviewInput({listingId:0,rating:5,text:"Great space"}));
  assert.ok(validateReviewInput({listingId:3,rating:6,text:"Great space"}));
  assert.ok(validateReviewInput({listingId:3,rating:0,text:"Great space"}));
  assert.ok(validateReviewInput({listingId:3,rating:5,text:"x"}));
  assert.ok(validateReviewInput({listingId:3,rating:5,text:"x".repeat(1501)}));
});
test("review endpoint never accepts a client user ID or unchecked booking completion",async()=>{
  const api=await readFile(new URL("../api/reviews.js",import.meta.url),"utf8");
  assert.match(api,/requireUser\(req, res\)/);
  assert.match(api,/\.eq\("renter_id", user\.id\)/);
  assert.match(api,/eligibleForReview\(b\)/);
  assert.match(api,/user_id: user\.id/);
  assert.match(api,/23505/);
  assert.doesNotMatch(api,/req\.body\?\.user_id/);
});
test("both client review forms use authenticated server API",async()=>{
  const app=await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");
  assert.equal(app.split('fetch("/api/reviews"').length-1,2);
  assert.doesNotMatch(app,/supabase\.from\("reviews"\)\.insert/);
});
test("review permission proposal removes unverified client inserts and enforces uniqueness",async()=>{
  const sql=await readFile(new URL("../docs/sql-proposals/qa-verified-reviews.sql",import.meta.url),"utf8");
  assert.match(sql,/REVOKE INSERT ON public\.reviews FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/UNIQUE INDEX IF NOT EXISTS reviews_one_per_driver_listing/);
  assert.match(sql,/\(listing_id,user_id\)/);
});
