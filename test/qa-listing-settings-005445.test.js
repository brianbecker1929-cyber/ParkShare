import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {editableListingAvailability,listingScheduleError,LISTING_FEATURE_OPTIONS} from '../src/lib/listingSettings.js';
import {createAvailabilityPreset,AVAILABILITY_DAYS,isListingAvailableForWindow} from '../src/lib/listingAvailability.js';
import {addCalendarDays,validateHostAvailabilityExceptions} from '../src/lib/availabilityExceptionDates.js';
import {listingSettingsMatch,createHostListingJournal} from '../src/lib/hostListingState.js';
import {listingAvailabilityMessage} from '../src/lib/spotAvailability.js';
const zone='America/Toronto',now=new Date('2026-11-01T15:00Z'),schedule=()=>createAvailabilityPreset('anytime',zone);
test('verified property clock owns edits, while historical exceptions are trimmed without changing input',()=>{
 const original={...schedule(),timezone:'Europe/Bucharest',exceptions:[{id:'past',type:'unavailable',startDate:'2026-10-01',endDate:'2026-10-30',windows:[]},{id:'ongoing',type:'unavailable',startDate:'2026-10-30',endDate:'2026-11-03',windows:[]}]};const copy=structuredClone(original),editable=editableListingAvailability(original,zone,now);assert.equal(editable.timezone,zone);assert.deepEqual(editable.exceptions,[{...original.exceptions[1],startDate:'2026-11-01'}]);assert.deepEqual(original,copy);for(const invalid of [null,'','Mars/Test'])assert.equal(editableListingAvailability(original,invalid,now),null);
});
test('all publishing presets remain editable with valid property-local weekly hours',()=>{
 for(const preset of ['anytime','weekdays','weekends','business','evenings'])assert.equal(listingScheduleError(createAvailabilityPreset(preset,zone),zone,false,now),'');
 const empty=createAvailabilityPreset('custom',zone);assert.match(listingScheduleError(empty,zone,false,now),/at least one time/);assert.equal(listingScheduleError(empty,zone,true,now),'');assert.deepEqual(LISTING_FEATURE_OPTIONS,['Covered','CCTV','Well-lit','Snow removal','EV charging','Gated']);
});
test('invalid windows, malformed and past/out-of-range dates cannot be saved',()=>{
 for(const windows of [[],[{start:'17:00',end:'09:00'}],[{start:'24:00',end:'25:00'}],Array.from({length:9},()=>({start:'09:00',end:'17:00'}))]){const s=schedule();s.weekly.mon.windows=windows;assert.match(listingScheduleError(s,zone,false,now),/valid hours/);}
 for(const item of [{startDate:'2026-10-31',endDate:'2026-11-02'},{startDate:'2026-11-02',endDate:'2026-11-01'},{startDate:'2028-11-01',endDate:'2028-11-01'},{startDate:'',endDate:''}])assert.ok(listingScheduleError({...schedule(),exceptions:[{id:'date',type:'unavailable',windows:[],...item}]},zone,false,now));
 assert.match(listingScheduleError({...schedule(),timezone:'Europe/Bucharest'},zone,false,now),/verified property time zone/);
 const invalid={...schedule(),exceptions:[{id:'date',type:'custom',startDate:'2026-11-02',endDate:'2026-11-02',windows:[]}]};assert.match(listingScheduleError(invalid,zone,false,now),/special dates/);
});
test('special dates and weekly edits affect only new availability calculations',()=>{
 const s=createAvailabilityPreset('business',zone);s.exceptions=[{id:'closed',type:'unavailable',startDate:'2026-11-02',endDate:'2026-11-02',windows:[]}];assert.equal(isListingAvailableForWindow(s,'2026-11-02T15:00Z','2026-11-02T16:00Z',zone),false);assert.equal(isListingAvailableForWindow(s,'2026-11-03T15:00Z','2026-11-03T16:00Z',zone),true);
});
test('canonical save verification and stale-read reconciliation include title, schedule and pause',()=>{
 const changes={title:'Updated',is_paused:true,availability:schedule()};assert.equal(listingSettingsMatch({...changes},changes),true);for(const field of ['title','is_paused','availability'])assert.equal(listingSettingsMatch({...changes,[field]:null},changes),false);
 const j=createHostListingJournal('A',null),read=j.version;j.save(7,{price:12,description:'',features:[],spots:[],spaces:1,...changes});const row=j.reconcile([{id:'db-7',title:'Old',active:true}],read)[0];assert.equal(row.title,'Updated');assert.equal(row.active,false);assert.deepEqual(row.availability,changes.availability);assert.match(listingAvailabilityMessage({reason:'listing_paused',hostScheduleOpen:false},'now'),/paused/);
});
const raw=await readFile(new URL('../src/components/ListingAvailabilityEditor.jsx',import.meta.url),'utf8');
const compiled=await transform(raw.replace(/^import .*;\n/gm,'').replace('export default function','function'),{loader:'jsx'});
let identity=0;
function editor(value=schedule(),paused=false,disabled=false){
 let current=value;const id=`schedule-${++identity}`,ref={current:0};const deps={React,useId:()=>id,useRef:()=>ref,AVAILABILITY_DAYS,createAvailabilityPreset,addCalendarDays,validateHostAvailabilityExceptions,listingScheduleError};const View=new Function(...Object.keys(deps),compiled.code+';return ListingAvailabilityEditor;')(...Object.values(deps));const C=new Proxy({},{get:()=>'#000'});
 const render=()=>View({value:current,paused,disabled,C,onChange:change=>{current=typeof change==='function'?change(current):change;}});
 const nodes=(node,out=[])=>{if(!React.isValidElement(node))return out;out.push(node);React.Children.forEach(node.props.children,child=>nodes(child,out));return out;};
 return {render,nodes:()=>nodes(render()),html:()=>renderToStaticMarkup(render()),get value(){return current;},button:text=>{const node=nodes(render()).find(n=>n.type==='button'&&n.props.children===text);assert.ok(node,text);node.props.onClick();}};
}
test('actual schedule editor supports preset changes while preserving special dates',()=>{
 const s=schedule();s.exceptions=[{id:'x',type:'unavailable',startDate:'2099-01-01',endDate:'2099-01-01',windows:[]}];const h=editor(s);h.button('Business hours · 9–5');assert.equal(h.value.weekly.mon.windows[0].start,'09:00');assert.equal(h.value.weekly.sun.enabled,false);assert.equal(h.value.exceptions.length,1);assert.match(h.html(),/property&#x27;s local time zone \(America\/Toronto\)/);
});
test('actual weekly controls update a specific day and expose labelled keyboard inputs',()=>{
 const h=editor();const monday=h.nodes().find(n=>n.type==='input'&&n.props.id.endsWith('-mon'));monday.props.onChange({target:{checked:false}});assert.equal(h.value.weekly.mon.enabled,false);assert.equal(h.value.weekly.tue.enabled,true);assert.equal(h.value.preset,'custom');const html=h.html();assert.match(html,/aria-label="Tuesday start time 1"/);assert.match(html,/for="schedule-\d+-tue"/);assert.match(html,/id="schedule-\d+-tue"/);
});
test('actual editor adds/removes exceptions and preserves a cleared invalid date for correction',()=>{
 const h=editor();h.button('+ Add special date');assert.equal(h.value.exceptions.length,1);const id=h.value.exceptions[0].id;h.nodes().find(n=>n.type==='input'&&n.props.type==='date').props.onChange({target:{value:''}});assert.equal(h.value.exceptions[0].startDate,'');assert.equal(h.value.exceptions[0].id,id);assert.match(h.html(),/Choose valid From and To dates/);h.button('Remove special date');assert.equal(h.value.exceptions.length,0);
});
test('unknown property timezone remains pausable while schedule controls fail closed; saving disables changes',()=>{
 assert.match(editor(null).html(),/You can still pause/);const h=editor(schedule(),true,true),before=structuredClone(h.value);h.button('Business hours · 9–5');h.button('+ Add special date');assert.deepEqual(h.value,before);assert.equal(h.render().props.disabled,true);
});
const api=(await readFile(new URL('../api/listing-availability.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export default async function handler','return async function handler');
test('paused availability returns no free bays before timezone or reservation/provider queries',async()=>{
 const admin={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{id:7,spaces:2,is_paused:true,spots:[{forRent:true},{forRent:true}],time_zone:null}})})})})};const handler=new Function('supabaseAdmin','jsonMethod','isValidBookingDuration','getListingSpotLayout',api)(admin,()=>true,()=>true,()=>[{label:'A',forRent:true},{label:'B',forRent:true}]);const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({query:{listingId:'7',hours:'1'}},res);assert.equal(res.code,200);assert.equal(res.body.reason,'listing_paused');assert.deepEqual(res.body.spotStatus,{A:false,B:false});assert.equal(res.body.spacesFree,0);
});
