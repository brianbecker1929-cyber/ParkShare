import test from "node:test";
import assert from "node:assert/strict";

import {
  NAVIGATION_PREFERENCE_KEY,
  buildNavigationUrl,
  hasNavigationDestination,
  openNavigation,
  getAvailableNavigationProviders,
  getPreferredNavigationProvider,
  savePreferredNavigationProvider,
} from "../src/lib/navigation.js";

test("BUG-005447 privacy labels with missing or invalid coordinates never become map searches", () => {
  for(const address of ["Approximate location — full address after confirmed booking","Approximate area","Address available with a confirmed booking","Exact parking location",""]){
    for(const [lat,lng] of [[null,null],[43.7,null],[null,-79.4],[NaN,-79.4],[91,-79.4],[43.7,181]]){
      assert.equal(hasNavigationDestination({address,lat,lng}),false);
      for(const provider of ['google','waze','apple'])assert.equal(buildNavigationUrl(address,lat,lng,'Android',provider),null);
    }
  }
});
test("BUG-005447 public routes use rounded area coordinates without exporting an address",()=>{
  for(const provider of ['google','waze','apple']){
    const url=new URL(buildNavigationUrl('PRIVATE STREET ADDRESS',43.789012,-79.456789,'Android',provider,'approximate'));
    const target=url.searchParams.get(provider==='google'?'destination':provider==='apple'?'daddr':'ll');
    assert.equal(target,'43.79,-79.46');assert.equal(url.searchParams.has('q'),false);assert.doesNotMatch(url.href,/PRIVATE|789012|456789/);
    assert.equal(buildNavigationUrl('PRIVATE STREET ADDRESS',null,null,'Android',provider,'approximate'),null);
  }
});
test("openNavigation refuses an unusable public destination before window.open",()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window'),calls=[];
  Object.defineProperty(globalThis,'window',{configurable:true,value:{navigator:{userAgent:'Android'},open:(...args)=>calls.push(args)}});
  try{
    assert.equal(openNavigation({address:'Approximate location — full address after confirmed booking',lat:null,lng:null},'google'),false);
    assert.equal(calls.length,0);
    assert.equal(openNavigation({address:'Approximate area',lat:43.789012,lng:-79.456789,locationPrecision:'approximate'},'google'),true);
    assert.equal(new URL(calls[0][0]).searchParams.get('destination'),'43.79,-79.46');assert.equal(calls[0][2],'noopener,noreferrer');
  }finally{if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;}
});

test("Google Maps route links prefer exact listing coordinates", () => {
  assert.equal(
    buildNavigationUrl("24 Horwood Crescent", 43.6532, -79.3832, "Mozilla/5.0 (Linux; Android 16)"),
    "https://www.google.com/maps/dir/?api=1&destination=43.6532%2C-79.3832&travelmode=driving",
  );
});

test("Apple Maps route links are used on iOS", () => {
  assert.equal(
    buildNavigationUrl("24 Horwood Crescent", 43.6532, -79.3832, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"),
    "https://maps.apple.com/?daddr=43.6532%2C-79.3832&dirflg=d",
  );
});

test("route links fall back to the encoded listing address", () => {
  assert.equal(
    buildNavigationUrl("24 Horwood Crescent, Toronto, ON", null, null, "Desktop"),
    "https://www.google.com/maps/dir/?api=1&destination=24%20Horwood%20Crescent%2C%20Toronto%2C%20ON&travelmode=driving",
  );
});

test("an explicit Google Maps choice is respected on iOS", () => {
  assert.equal(
    buildNavigationUrl("24 Horwood Crescent", 43.6532, -79.3832, "Mozilla/5.0 (iPhone)", "google"),
    "https://www.google.com/maps/dir/?api=1&destination=43.6532%2C-79.3832&travelmode=driving",
  );
});

test("Waze route links include the ParkShare address and exact listing coordinates", () => {
  assert.equal(
    buildNavigationUrl("24 Horwood Crescent", 43.6532, -79.3832, "Mozilla/5.0 (Linux; Android 16)", "waze"),
    "https://waze.com/ul?q=24%20Horwood%20Crescent&ll=43.6532%2C-79.3832&navigate=yes&utm_source=parkshare",
  );
});

test("Waze route links use exact coordinates when an address is unavailable", () => {
  assert.equal(
    buildNavigationUrl("", 43.6532, -79.3832, "Mozilla/5.0 (Linux; Android 16)", "waze"),
    "https://waze.com/ul?ll=43.6532%2C-79.3832&navigate=yes&utm_source=parkshare",
  );
});

test("Waze route links fall back to the encoded listing address", () => {
  assert.equal(
    buildNavigationUrl("24 Horwood Crescent, Toronto, ON", null, null, "Desktop", "waze"),
    "https://waze.com/ul?q=24%20Horwood%20Crescent%2C%20Toronto%2C%20ON&navigate=yes&utm_source=parkshare",
  );
});

test("Apple Maps is offered only on supported Apple devices", () => {
  assert.deepEqual(
    getAvailableNavigationProviders("Mozilla/5.0 (Linux; Android 16)").map(provider => provider.id),
    ["waze", "google"],
  );
  assert.deepEqual(
    getAvailableNavigationProviders("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)").map(provider => provider.id),
    ["waze", "google", "apple"],
  );
});

test("the most recently selected navigation provider can be remembered", () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(getPreferredNavigationProvider(storage), null);
  assert.equal(savePreferredNavigationProvider("waze", storage), true);
  assert.equal(values.get(NAVIGATION_PREFERENCE_KEY), "waze");
  assert.equal(getPreferredNavigationProvider(storage), "waze");
  assert.equal(savePreferredNavigationProvider("unsupported", storage), false);
});
