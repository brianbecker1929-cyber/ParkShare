import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {hasListingCoordinates,changeListingAddress} from '../src/lib/listingLocation.js';
import {validateCanadianPostalCode} from '../src/lib/canadianPostalCode.js';
import {createAvailabilityPreset,normalizeAvailability} from '../src/lib/listingAvailability.js';
const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const root=app.indexOf('function ListDrivewayView(');
const update=app.slice(app.indexOf('  const update = ',root),app.indexOf('  const inputStyle = ',root));
const search=app.slice(app.indexOf('  const searchAddress = ',root),app.indexOf('  const submitVerification = ',root));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function harness(){
 let form={street:'Original',city:'Toronto',region:'ON',postal:'M5V 2T6',lat:43.65,lng:-79.38,spots:[{forRent:true}],availability:createAvailabilityPreset()},suggestions=[],loading=false;
 const timers=new Map(),requests=[],debounceRef={current:null},addressRequest={current:0},addressAbort={current:null};let id=0;
 const deps={setZoneRetry:()=>{},debounceRef,addressRequest,addressAbort,changeListingAddress,validateCanadianPostalCode,AbortController,
  setForm:fn=>{form=fn(form);},setSuggestions:value=>{suggestions=value;},setLoadingSug:value=>{loading=value;},
  setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id),fetch:async(url,options)=>{const d=deferred();requests.push({url,options,...d});return d.promise;}};
 const keys=Object.keys(deps);const handlers=new Function(...keys,update+search+';return {update,searchAddress,chooseSuggestion};')(...Object.values(deps));
 return {...handlers,requests,get form(){return form;},get suggestions(){return suggestions;},get loading(){return loading;},fire(){const [key,fn]=[...timers][0];timers.delete(key);return fn();}};
}
const oldResult=[{address:{house_number:'1',road:'Old Road',city:'Toronto',state:'ON',postcode:'M5V 2T6'},lat:'43.65',lon:'-79.38'}];
test('a delayed address response cannot restore a pin after the Host changes the city',async()=>{
 const h=harness();h.searchAddress('Old Road');const running=h.fire();assert.equal(h.form.lat,null);
 h.update('city','Vancouver');h.requests[0].resolve(Response.json(oldResult));await running;
 assert.deepEqual(h.suggestions,[]);assert.equal(h.form.city,'Vancouver');assert.equal(h.form.lat,null);assert.equal(h.loading,false);
});
test('selecting a new suggestion invalidates pending old searches and old bay geometry',async()=>{
 const h=harness();h.searchAddress('Old Road');const running=h.fire();
 h.chooseSuggestion({street:'New Road',city:'Vancouver',region:'BC',postal:'V6B 1A1',lat:49.28,lng:-123.12});
 h.requests[0].resolve(Response.json(oldResult));await running;
 assert.equal(h.form.lat,49.28);assert.equal(h.form.lng,-123.12);assert.deepEqual(h.form.spots,[]);assert.deepEqual(h.suggestions,[]);
});
test('only the latest typed address response can provide selectable suggestions',async()=>{
 const h=harness();h.searchAddress('Old Road');const old=h.fire();h.searchAddress('New Road');const current=h.fire();
 h.requests[1].resolve(Response.json([{...oldResult[0],address:{...oldResult[0].address,road:'New Road'}}]));await current;
 h.requests[0].resolve(Response.json(oldResult));await old;assert.equal(h.suggestions[0].street,'1 New Road');
});
test('BUG-005438 repeated Toronto address results appear once while St. Marys stays selectable',async()=>{
 const toronto={address:{house_number:'100',road:'Queen Street West',city:'Toronto',state:'Ontario',postcode:'M5H 2N2'},lat:'43.6534',lon:'-79.3841'};
 const stMarys={address:{...toronto.address,city:'St. Marys',postcode:'N4X 1A1'},lat:'43.259',lon:'-81.142'};
 const h=harness();h.searchAddress('100 Queen St W');const running=h.fire();
 h.requests[0].resolve(Response.json([toronto,{...toronto,lat:'43.6535'},{...toronto,lon:'-79.3842'},toronto,stMarys]));await running;
 assert.equal(h.suggestions.length,2);assert.equal(h.suggestions[0].label,'100, Queen Street West, Toronto, Ontario');
 assert.equal(h.suggestions[0].lat,43.6534);assert.equal(h.suggestions[0].lng,-79.3841,'Keep the first result rather than mixing duplicate coordinates');
 assert.match(h.suggestions[1].label,/St\. Marys/);h.chooseSuggestion(h.suggestions[1]);
 assert.equal(h.form.city,'St. Marys');assert.equal(h.form.lat,43.259);assert.equal(h.form.lng,-81.142);assert.equal(h.form.postal,'N4X 1A1');assert.deepEqual(h.form.spots,[]);
});
test('BUG-005438 spacing/case duplicates collapse without merging distinct village addresses or searches',async()=>{
 const row={address:{house_number:'100',road:'Queen Street West',village:'Village A',state_district:'Ontario'},lat:'43.65',lon:'-79.38'};
 const h=harness();h.searchAddress('100 Queen');let running=h.fire();
 h.requests[0].resolve(Response.json([row,{...row,address:{...row.address,road:' QUEEN  STREET WEST '},lat:'43.66'},
   {...row,address:{...row.address,village:'Village B'}},{...row,address:{...row.address,house_number:'101'}}]));await running;
 assert.equal(h.suggestions.length,3);assert.match(h.suggestions[0].label,/Village A, Ontario/);assert.match(h.suggestions[1].label,/Village B, Ontario/);
 assert.equal(h.suggestions[2].street,'101 Queen Street West');
 h.searchAddress('100 Queen again');running=h.fire();h.requests[1].resolve(Response.json([row]));await running;
 assert.equal(h.suggestions.length,1,'Deduplication is scoped to each response, not a previous search');
});
test('an old timezone response cannot overwrite the current pin or property-local schedule',async()=>{
 const start=app.indexOf('  const locationKey = ',root),end=app.indexOf('  const [suggestions,',start),snippet=app.slice(start,end);
 let effect,zoneResult=null,form={lat:43.65,lng:-79.38,availability:createAvailabilityPreset('anytime','Pacific/Auckland')};
 const requests=[];const deps={hasListingCoordinates,normalizeAvailability,supabase:{},user:{id:'synthetic-host'},AbortController,
  useEffect:fn=>{effect=fn;},setZoneResult:value=>{zoneResult=value;},setForm:fn=>{form=fn(form);},requestPropertyTimeZone:async(client,point,signal)=>{const d=deferred();requests.push({...d,point,signal});return d.promise;}};
 const render=()=>{const values={...deps,form,zoneResult,zoneRetry:0};return new Function(...Object.keys(values),snippet+';return propertyTimeZone;')(...Object.values(values));};
 render();const cleanup=effect();cleanup();form={...form,lat:46.77,lng:23.59};render();effect();
 requests[1].resolve('Europe/Bucharest');await new Promise(r=>setImmediate(r));requests[0].resolve('America/Toronto');await new Promise(r=>setImmediate(r));
 assert.equal(render(),'Europe/Bucharest');assert.equal(form.availability.timezone,'Europe/Bucharest');assert.equal(requests[0].signal.aborted,true);
});
