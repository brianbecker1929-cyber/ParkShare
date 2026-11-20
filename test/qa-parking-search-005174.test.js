import assert from 'node:assert/strict';
import test from 'node:test';
import {PARKING_SEARCH_RADIUS_KM,validParkingCoordinate,parkingDistanceKm,nearbyParkingListings,matchesParkingText,parkingSearchEmptyState} from '../src/lib/parkingSearch.js';
import {buildWalkingLabel,computeWalkingRoutes} from '../src/lib/walkingTime.js';
const origin={lat:43.8,lng:-79.5};
const near={id:'near',...origin,title:'Private parking available',address:'Approximate location',locationPrecision:'approximate'};
const far={...near,id:'far',lat:45.4,lng:-75.7};
test('destination radius removes distant and missing-coordinate driveways',()=>{
  const results=nearbyParkingListings([near,far,{...near,id:'missing',lat:null}],{origin});
  assert.deepEqual(results.map(l=>l.id),['near']);assert.equal(results[0].distMiles,0);
});
test('five-kilometre boundary uses public coordinates without requiring hidden data',()=>{
  const delta=degrees=>({...near,lat:origin.lat+degrees});
  const kmToDegrees=180/(Math.PI*6371.0088);
  const inside=delta(4.999*kmToDegrees),outside=delta(5.001*kmToDegrees);
  assert.ok(Math.abs(parkingDistanceKm(origin,inside)-4.999)<1e-7);
  assert.equal(nearbyParkingListings([inside,outside],{origin}).length,1);
  assert.equal(PARKING_SEARCH_RADIUS_KM,5);
});
test('text search applies to approximate public listings with or without My location',()=>{
  assert.deepEqual(nearbyParkingListings([near,far],{origin,query:'zz-no-match'}),[]);
  assert.deepEqual(nearbyParkingListings([near],{query:'zz-no-match'}),[]);
  assert.equal(nearbyParkingListings([near,far],{origin,query:' PRIVATE '}).length,1);
});
test('plain browse retains listings without coordinates and has no fabricated distance',()=>{
  const results=nearbyParkingListings([near,{id:'unknown'}]);
  assert.equal(results.length,2);assert.equal(results[0].distMiles,null);assert.equal(results[1].distMiles,null);
});
test('text matching tolerates missing fields and whitespace',()=>{
  assert.equal(matchesParkingText({},' x '),false);assert.equal(matchesParkingText({},'  '),true);
  assert.equal(matchesParkingText({address:'North York'},'north york'),true);
});
for(const point of [null,{lat:91,lng:0},{lat:0,lng:-181},{lat:'43',lng:0},{lat:NaN,lng:0},{lat:0,lng:Infinity}]){
  test(`invalid coordinates cannot produce nearby results: ${JSON.stringify(point)}`,()=>{
    assert.equal(validParkingCoordinate(point),false);
    assert.equal(parkingDistanceKm(origin,point),null);
    assert.deepEqual(nearbyParkingListings([near],{origin:point||{}}),[]);
  });
}
test('haversine calculation is stable at the dateline and antipodes',()=>{
  assert.ok(parkingDistanceKm({lat:0,lng:179.99},{lat:0,lng:-179.99})<3);
  assert.ok(Number.isFinite(parkingDistanceKm({lat:0,lng:0},{lat:0,lng:180})));
});
test('empty-state copy distinguishes destination, text and device location searches',()=>{
  assert.equal(parkingSearchEmptyState({origin,destinationSelected:true}).title,'No parking nearby');
  assert.match(parkingSearchEmptyState({origin,destinationSelected:false}).message,/5 km of your location/);
  assert.match(parkingSearchEmptyState({origin,query:'zz'}).message,/“zz”.*within 5 km/);
  assert.equal(parkingSearchEmptyState({query:'zz'}).title,'No parking matches your search');
});
test('coarse public coordinates cannot display a precise route or loading indicator',()=>{
  const label=buildWalkingLabel({destinationSelected:true,approximateLocation:true,loading:true,route:{minutes:999,distanceMeters:999999},distanceMiles:0.5});
  assert.match(label,/≈ 10 min walk.*approximate area/);assert.doesNotMatch(label,/999|Calculating/);
});
test('an explicit unavailable pedestrian route does not fall back to an invented walk',()=>{
  assert.equal(buildWalkingLabel({destinationSelected:true,route:{unavailable:true},distanceMiles:0.1}),'🚶 Walking route unavailable');
});
test('route matrix failures and malformed metrics produce unavailable walks',async()=>{
  globalThis.window={google:{maps:{importLibrary:async()=>({RouteMatrix:{computeRouteMatrix:async()=>({matrix:{rows:[
    {items:[{condition:'ROUTE_NOT_FOUND'}]},
    {items:[{condition:'ROUTE_EXISTS',durationMillis:-1,distanceMeters:100}]},
    {items:[{condition:'ROUTE_EXISTS',durationMillis:60000,distanceMeters:-5}]},
  ]}})}})}}};
  try {
    assert.deepEqual(await computeWalkingRoutes(['a','b','c'].map(id=>({...origin,id})),origin),
      {a:{unavailable:true},b:{unavailable:true},c:{unavailable:true}});
  } finally {delete globalThis.window;}
});
