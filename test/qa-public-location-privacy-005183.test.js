import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PUBLIC_DISCOVERY_COLUMNS, publicDiscoveryListing, approximateParkingCoordinate } from "../src/lib/publicDiscovery.js";

test("public discovery projection excludes confidential database columns", () => {
  for (const column of ["host_id","address","photos","img","description","profiles","reviews","email","user_id"]) {
    assert.equal(PUBLIC_DISCOVERY_COLUMNS.split(",").includes(column), false, column);
  }
});

test("public listing does not reveal street addresses, exact coordinates, or identities", () => {
  const result = publicDiscoveryListing({
    id: 5, host_id: "host-uuid", address: "123 Main St, Toronto",
    title: "123 Main St Driveway", description: "The blue door at 123 Main St",
    lat: 43.824194, lng: -79.418116, price: 12, spaces: 2,
    profiles: { id: "host-uuid", name: "Host" },
    reviews: [{ user_id:"reviewer-uuid", rating:5 }],
    features:["at 123 Main St"], photos:["gps-exif"],
  });
  assert.deepEqual(result,{
    id:5,title:"Private parking available",
    address:"Approximate location — full address after confirmed booking",
    price:12,spaces:2,features:[],description:"",img:null,photos:[],
    spots:[],lat:43.82,lng:-79.42,rating:0,reviewCount:0,
    host:"ParkShare Host",locationPrecision:"approximate",
  });
  const encoded=JSON.stringify(result);
  for(const privateValue of ["123 Main St","host-uuid","reviewer-uuid","43.824194","-79.418116"]) {
    assert.equal(encoded.includes(privateValue),false);
  }
});

test("invalid coordinates never become public exact points", () => {
  assert.equal(approximateParkingCoordinate(null),null);
  assert.equal(approximateParkingCoordinate(""),null);
  assert.equal(approximateParkingCoordinate("not-a-coordinate"),null);
});

test("public endpoint does not select sensitive columns or return raw Supabase records", async () => {
  const endpoint=await readFile(new URL("../api/public-parking.js",import.meta.url),"utf8");
  assert.match(endpoint,/\.select\(PUBLIC_DISCOVERY_COLUMNS\)/);
  assert.match(endpoint,/\.map\(l => publicDiscoveryListing\(/);
  assert.doesNotMatch(endpoint,/\.select\(["']\*["']\)/);
  assert.doesNotMatch(endpoint,/return res\.status\(200\)\.json\(\{ ?listings: ?data/);
});
