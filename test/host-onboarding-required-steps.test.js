import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transform} from 'esbuild';
import {hasListingCoordinates,changeListingAddress} from '../src/lib/listingLocation.js';
import {validateCanadianPostalCode} from '../src/lib/canadianPostalCode.js';
import {AVAILABILITY_DAYS,createAvailabilityPreset,normalizeAvailability,formatAvailabilitySummary,hasAnyAvailability} from '../src/lib/listingAvailability.js';
import {validateHostAvailabilityExceptions} from '../src/lib/availabilityExceptionDates.js';
import {validateHourlyRate,NEW_LISTING_MAX_HOURLY_RATE_CAD} from '../src/lib/listingPrice.js';

const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const start=app.indexOf('function ListDrivewayView(');
const source=app.slice(start,app.indexOf('// ─── My Bookings',start));
const stateNames=[...source.matchAll(/const \[(\w+),[^\]]+\] = useState\(/g)].map(match=>match[1]);
const built=await transform(source,{loader:'jsx',define:{'import.meta.env.VITE_GOOGLE_MAPS_API_KEY':'MAP_KEY'}});
function nodes(node,predicate){
  if(!React.isValidElement(node))return [];
  return [...(predicate(node)?[node]:[]),...React.Children.toArray(node.props.children).flatMap(child=>nodes(child,predicate))];
}
function text(node){return typeof node==='string'||typeof node==='number'?String(node):React.isValidElement(node)?React.Children.toArray(node.props.children).map(text).join(''):'';}
function harness({mapKey=''}={}){
  const state=[],refs=[],published=[];let stateCursor=0,refCursor=0;
  const journal={pending:false,publish:async()=>{published.push(true);throw Error('No real publication in this test');}};
  const deps={submitHostApplication:()=>{},React,MAP_KEY:mapKey,C:{},supabase:{},createListingPublication:()=>journal,
    hasListingCoordinates,changeListingAddress,validateCanadianPostalCode,AVAILABILITY_DAYS,createAvailabilityPreset,normalizeAvailability,
    formatAvailabilitySummary,hasAnyAvailability,validateHostAvailabilityExceptions,validateHourlyRate,NEW_LISTING_MAX_HOURLY_RATE_CAD,
    MAX_LISTING_PHOTOS:6,PriceTag:'price-tag',DrivewaySpotPreview:'spot-preview',Btn:'button',Badge:'span',ParkerTip:'aside',PinAdjustMap:'pin-map',SpotMapBoundary:'map-boundary',
    DrivewaySpotSatelliteMap:'satellite-picker',DrivewaySpotMap:'spot-picker',ListingFeatureFields:'feature-fields',OwnershipDocumentStep:'ownership-proof',ListingSatelliteView:'satellite-preview',
    money:value=>`$${Number(value).toFixed(2)}`,useEffect:()=>{},useCallback:fn=>fn,useMemo:fn=>fn(),
    useState:initial=>{const i=stateCursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},
    useRef:initial=>{const i=refCursor++;return refs[i]??=( {current:initial} );}};
  const View=new Function(...Object.keys(deps),built.code+';return ListDrivewayView;')(...Object.values(deps));
  const get=name=>state[stateNames.indexOf(name)];
  const set=(name,value)=>{assert.ok(stateNames.includes(name),name);state[stateNames.indexOf(name)]=value;};
  const render=()=>{stateCursor=0;refCursor=0;return View({user:{id:'synthetic-host',role:'host'}});};
  render();
  return {render,get,set,published,form:patch=>set('form',{...get('form'),...patch}),
    button:label=>{const found=nodes(render(),n=>n.type==='button'&&text(n)===label)[0];assert.ok(found,`Button ${label}`);return found;},
    ready(){this.form({street:'123 Test Street',city:'Toronto',region:'Ontario',postal:'M5V 2T6',lat:43.65,lng:-79.38,
      ownershipApplicationId:'00000000-0000-4000-8000-000000000001',photos:[{name:'driveway.jpg',url:'blob:synthetic'}],price:'4'});set('zoneResult',{key:'43.65:-79.38',timeZone:'America/Toronto'});}};
}

test('all eight screens have no beta skip or duplicate default-availability shortcut',()=>{
  const h=harness();h.ready();
  for(let step=1;step<=8;step++){h.set('step',step);const buttons=nodes(h.render(),n=>n.type==='button').map(text);assert.ok(!buttons.some(label=>/skip for now|use default availability/i.test(label)),`Step ${step}`);}
});
test('location cannot advance without an address, selected map coordinates and confirmed timezone',()=>{
  const h=harness();let next=h.button('Continue →');assert.equal(next.props.disabled,true);next.props.onClick();assert.equal(h.get('step'),1);
  h.ready();h.form({lat:null,lng:null});next=h.button('Continue →');assert.equal(next.props.disabled,true);next.props.onClick();assert.equal(h.get('step'),1);
  h.ready();h.set('zoneResult',null);next=h.button('Continue →');assert.equal(next.props.disabled,true);next.props.onClick();assert.equal(h.get('step'),1);
  h.ready();next=h.button('Continue →');assert.equal(next.props.disabled,false);next.props.onClick();assert.equal(h.get('step'),2);
});
test('verification cannot be bypassed through Continue or preview publication',async()=>{
  const h=harness();h.ready();h.form({ownershipApplicationId:null});h.set('step',2);
  const next=h.button('Continue →');assert.equal(next.props.disabled,true);next.props.onClick();assert.equal(h.get('step'),2);
  h.set('step',8);const publish=h.button('Submit application');assert.equal(publish.props.disabled,true);await publish.props.onClick();assert.equal(h.get('step'),2);assert.deepEqual(h.published,[]);
});
test('photos and rentable spaces are mandatory before advancing',()=>{
  const h=harness();h.ready();h.form({photos:[]});h.set('step',3);let next=h.button('Continue →');assert.equal(next.props.disabled,true);next.props.onClick();assert.equal(h.get('step'),3);
  h.ready();h.form({selectedSpots:[false,false,false]});h.set('step',4);next=h.button('Continue →');assert.equal(next.props.disabled,true);next.props.onClick();assert.equal(h.get('step'),4);
});
test('map mode requires an actually marked space and safely falls back when imagery is unavailable',()=>{
  const h=harness({mapKey:'synthetic-key'});h.ready();h.set('step',4);assert.equal(h.button('Continue →').props.disabled,true,'fallback defaults cannot count as drawn spaces');
  const picker=nodes(h.render(),n=>n.type==='satellite-picker')[0];picker.props.onUnavailable();assert.equal(nodes(h.render(),n=>n.type==='spot-picker').length,1);assert.equal(h.button('Continue →').props.disabled,false);
  h.form({selectedSpots:[false,false,false]});assert.equal(h.button('Continue →').props.disabled,true,'manual fallback still requires a rentable space');
});
test('invalid availability and price cannot advance; corrected required steps reach Preview',()=>{
  const h=harness();h.ready();h.set('step',6);const unavailable=createAvailabilityPreset();for(const day of Object.values(unavailable.weekly))day.enabled=false;
  h.form({availability:unavailable});let next=h.button('Continue →');assert.equal(next.props.disabled,true);next.props.onClick();assert.equal(h.get('step'),6);
  h.form({availability:createAvailabilityPreset()});h.button('Continue →').props.onClick();assert.equal(h.get('step'),7);
  h.form({price:'0'});next=h.button('Preview listing →');assert.equal(next.props.disabled,true);next.props.onClick();assert.equal(h.get('step'),7);
  h.form({price:'4'});h.button('Preview listing →').props.onClick();assert.equal(h.get('step'),8);assert.equal(h.button('Submit application').props.disabled,false);
});
