import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PUBLIC_DISCOVERY_COLUMNS, publicDiscoveryListing, publicParkingCoordinate } from "../src/lib/publicDiscovery.js";

test("public discovery projection excludes confidential database columns", () => {
  for (const column of ["host_id","photos","img","description","profiles","reviews","email","user_id"]) {
    assert.equal(PUBLIC_DISCOVERY_COLUMNS.split(",").includes(column), false, column);
  }
});

test("public listing shows driveway images and exact location while retaining account and arrival privacy", () => {
  const result = publicDiscoveryListing({
    id: 5, host_id: "host-uuid", address: "123 Main St, Toronto",
    title: "123 Main St Driveway", description: "The blue door at 123 Main St",
    lat: 43.824194, lng: -79.418116, price: 12, spaces: 2,
    profiles: { id: "host-uuid", name: "Host" },
    reviews: [{ user_id:"reviewer-uuid", rating:5 }],
    features:["at 123 Main St"], photos:["gps-exif"],
  });
  assert.deepEqual(result,{
    id:5,title:"123 Main St Driveway",
    address:"123 Main St, Toronto",
    price:12,spaces:2,features:[],description:"",img:"/api/listing-photo?listingId=5",photos:["/api/listing-photo?listingId=5"],
    spots:[],lat:43.824194,lng:-79.418116,rating:0,reviewCount:0,
    host:"ParkShare Host",bookingStatus:"unknown",locationPrecision:"exact",
  });
  const encoded=JSON.stringify(result);
  for(const privateValue of ["host-uuid","reviewer-uuid","The blue door","gps-exif"]) {
    assert.equal(encoded.includes(privateValue),false);
  }
});

test("invalid coordinates never become invented map points", () => {
  assert.equal(publicParkingCoordinate(null,90),null);
  assert.equal(publicParkingCoordinate("",90),null);
  assert.equal(publicParkingCoordinate("not-a-coordinate",90),null);
  assert.equal(publicParkingCoordinate(91,90),null);
  assert.equal(publicParkingCoordinate(-181,180),null);
  assert.equal(publicParkingCoordinate(43.824194,90),43.824194);
});

test("public endpoint does not select sensitive columns or return raw Supabase records", async () => {
  const endpoint=await readFile(new URL("../api/public-parking.js",import.meta.url),"utf8");
  assert.match(endpoint,/\.rpc\("public_parking_page"/);
  assert.match(endpoint,/\.map\(l => publicDiscoveryListing\(/);
  assert.doesNotMatch(endpoint,/\.select\(["']\*["']\)/);
  assert.doesNotMatch(endpoint,/return res\.status\(200\)\.json\(\{ ?listings: ?data/);
});
