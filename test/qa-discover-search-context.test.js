import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {RESTAURANT_CUISINES,buildRestaurantSearchText,normalizeRestaurantPlace,chooseRandomRestaurant} from '../src/lib/restaurants.js';
import {EVENT_CATEGORIES,filterEvents,normalizeEventRow,formatEventSchedule} from '../src/lib/events.js';
const source=await readFile(process.env.QA_DISCOVER_SOURCE||new URL('../src/App.jsx',import.meta.url),'utf8');
const start=source.indexOf('function DiscoverView(');
const compiled=(await transform(source.slice(start,source.indexOf('// ─── Browse View',start)),{loader:'jsx',define:{'import.meta.env.VITE_GOOGLE_MAPS_API_KEY':'"synthetic"'}})).code;
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const place=(id='new')=>({id,displayName:'Restaurant '+id,formattedAddress:'Synthetic '+id,location:{lat:()=>43.8,lng:()=>-79.5},primaryTypeDisplayName:'Restaurant'});
const event=(id=1,name='Music Festival',category='festival')=>({id,name,category,lat:43.8,lng:-79.5,starts_at:'2030-11-01T20:00:00Z',timezone:'America/Toronto',venue_name:'Synthetic Hall',status:'published'});
function nodes(node,predicate,out=[]){if(!node||typeof node!=='object')return out;if(predicate(node))out.push(node);for(const child of React.Children.toArray(node.props?.children))nodes(child,predicate,out);return out;}
function harness({mode:initialMode='restaurants',placesLoaded=true,searchPlaces=async()=>({places:[place()]}),readEvents=async()=>({data:[event()],error:null}),loadLibrary}={}){
 const slots=[],effects=[],setups=[],writes=[],searches=[],imports=[],eventReads=[],navigations=[],modeChanges=[];let cursor=0,dirty=false,tree,mode=initialMode,browsed=0;
 const google={maps:{importLibrary:async name=>{imports.push(name);return loadLibrary?loadLibrary(imports.length):{Place:{searchByText:async options=>{searches.push(options);return searchPlaces(searches.length,options);}}};}}};
 const effect=(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((x,i)=>x!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();setups[n]=fn;});}};
 const values={React,google,window:{google},GOOGLE_MAPS_LIBRARIES:['places'],useJsApiLoader:()=>({isLoaded:placesLoaded}),RESTAURANT_CUISINES,buildRestaurantSearchText,normalizeRestaurantPlace,chooseRandomRestaurant,EVENT_CATEGORIES,filterEvents,normalizeEventRow,formatEventSchedule,ResponsiveMascot:()=>null,Modal:()=>null,EventSubmissionForm:()=>null,
 useState:initial=>{const n=cursor++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{writes.push(n);const next=typeof v==='function'?v(slots[n].value):v;if(next!==slots[n].value){slots[n].value=next;dirty=true;}}];},
 useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},
 useMemo:(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((x,i)=>x!==old.deps[i]))slots[n]={value:fn(),deps};return slots[n].value;},useEffect:effect,useLayoutEffect:effect,
 supabase:{from:table=>{const request={table};return {select:fields=>{request.fields=fields;return {eq:(key,value)=>{request.equal=[key,value];return {gte:(key,value)=>{request.since=[key,value];return {order:(key,value)=>{request.order=[key,value];return {limit:async limit=>{request.limit=limit;eventReads.push(request);return readEvents(eventReads.length);}};}};}};}};}};}}};
 const Component=new Function(...Object.keys(values),compiled+';return DiscoverView;')(...Object.values(values));
 function render(){let count=0;do{dirty=false;cursor=0;tree=Component({mode,onModeChange:label=>modeChanges.push(label),onFindParking:value=>navigations.push(value),onBrowseParking:()=>browsed++});for(const fn of effects.splice(0))fn();assert.ok(++count<8);}while(dirty);return tree;}
 const find=predicate=>{const n=nodes(render(),predicate)[0];assert.ok(n,'control exists');return n;};
 const submit=()=>find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 const adventure=()=>find(n=>n.type==='button'&&String(n.props.children).includes('Be Adventurous')).props.onClick();
 const change=(label,value)=>find(n=>n.props?.['aria-label']===label).props.onChange({target:{value}});
 const stop=()=>{for(const slot of slots)slot?.cleanup?.();};
 const replay=()=>{for(const [n,fn] of setups.entries())if(fn){slots[n].cleanup?.();slots[n].cleanup=fn();}render();};
 render();return {render,find,submit,adventure,change,stop,replay,searches,imports,eventReads,navigations,modeChanges,writes,setMode:value=>{mode=value;render();},back:()=>find(n=>n.props?.className==='ps-discover-back').props.onClick(),get text(){return JSON.stringify(render());},get browsed(){return browsed;}};
}

test('adventure cannot navigate after Back, even before the parent changes mode',async()=>{
 const pending=later(),h=harness({searchPlaces:()=>pending.promise}),work=h.adventure();await tick();h.back();const n=h.writes.length;pending.resolve({places:[place('obsolete')]});await work;assert.deepEqual(h.modeChanges,['Discover']);assert.equal(h.navigations.length,0);assert.equal(h.writes.length,n);h.stop();
});
test('changing restaurant query or cuisine retires an old adventure and unlocks the new search',async()=>{
 for(const [label,value] of [['Restaurant name or area','New area'],['Cuisine','italian_restaurant']]){const pending=later(),h=harness({searchPlaces:async n=>n===1?pending.promise:{places:[place('current')]}}),work=h.adventure();await tick();h.change(label,value);h.render();assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);await h.submit();pending.resolve({places:[place('obsolete')]});await work;assert.equal(h.navigations.length,0);assert.match(h.text,/Restaurant current/);assert.doesNotMatch(h.text,/Restaurant obsolete/);h.stop();}
});
test('mode changes, including restaurants to events to restaurants, cannot revive an adventure',async()=>{
 for(const modes of [['events'],['events','restaurants'],[null,'restaurants']]){const pending=later(),h=harness({searchPlaces:()=>pending.promise}),work=h.adventure();await tick();for(const mode of modes)h.setMode(mode);const n=h.writes.length;pending.resolve({places:[place('obsolete')]});await work;assert.equal(h.navigations.length,0);assert.equal(h.writes.length,n);h.stop();}
});
test('leaving during Places library loading prevents the billable follow-up search',async()=>{
 const pending=later();let queries=0;const h=harness({loadLibrary:()=>pending.promise}),work=h.adventure();h.back();pending.resolve({Place:{searchByText:async()=>{queries++;return {places:[place()]};}}});await work;assert.equal(queries,0);assert.equal(h.navigations.length,0);h.stop();
});
test('restaurant requests lock synchronously across Search and Be Adventurous',async()=>{
 const pending=later(),h=harness({searchPlaces:()=>pending.promise}),oldSearch=h.find(n=>n.type==='form').props.onSubmit,oldAdventure=h.find(n=>n.type==='button'&&String(n.props.children).includes('Be Adventurous')).props.onClick;
 const work=oldSearch({preventDefault(){}}),duplicate=oldAdventure();await tick();assert.equal(h.imports.length,1);assert.equal(h.searches.length,1);pending.resolve({places:[place()]});await Promise.all([work,duplicate]);assert.equal(h.navigations.length,0);h.stop();
});
test('older restaurant successes and failures cannot overwrite a newer query or loading state',async()=>{
 for(const failure of [false,true]){const old=later(),current=later(),h=harness({searchPlaces:async n=>n===1?old.promise:current.promise}),a=h.submit();await tick();h.change('Restaurant name or area','Current');h.render();const b=h.submit();await tick();const n=h.writes.length;if(failure)old.reject(Error('OLD PRIVATE ERROR'));else old.resolve({places:[place('obsolete')]});await a;assert.equal(h.writes.length,n);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,true);current.resolve({places:[place('current')]});await b;assert.match(h.text,/Restaurant current/);assert.doesNotMatch(h.text,/obsolete|OLD PRIVATE ERROR/);h.stop();}
});
test('query A to B to A rejects old submit and destination callbacks',async()=>{
 const h=harness();h.change('Restaurant name or area','Area A');await h.submit();const oldSubmit=h.find(n=>n.type==='form').props.onSubmit,oldSelect=h.find(n=>n.type==='button'&&n.props.children==='Find parking nearby').props.onClick;h.change('Restaurant name or area','Area B');h.render();h.change('Restaurant name or area','Area A');h.render();const n=h.writes.length;await oldSubmit({preventDefault(){}});oldSelect();assert.equal(h.searches.length,1);assert.equal(h.navigations.length,0);assert.equal(h.writes.length,n);h.stop();
});
test('obsolete restaurant cards cannot select while a new request is loading or after it completes',async()=>{
 const pending=later(),h=harness({searchPlaces:async n=>n===1?{places:[place('first')]}:pending.promise});await h.submit();const oldSelect=h.find(n=>n.type==='button'&&n.props.children==='Find parking nearby').props.onClick,work=h.submit();oldSelect();assert.equal(h.navigations.length,0);pending.resolve({places:[place('second')]});await work;oldSelect();assert.equal(h.navigations.length,0);h.find(n=>n.type==='button'&&n.props.children==='Find parking nearby').props.onClick();assert.equal(h.navigations[0].query,'Restaurant second');h.stop();
});
test('normal search and adventure preserve filters, bounded Places fields and parking destination',async()=>{
 for(const action of ['search','adventure']){const h=harness();h.change('Restaurant name or area','Vaughan');h.render();h.change('Cuisine','italian_restaurant');if(action==='search'){await h.submit();h.find(n=>n.type==='button'&&n.props.children==='Find parking nearby').props.onClick();}else await h.adventure();assert.equal(h.searches.length,1);assert.equal(h.searches[0].textQuery,'Vaughan Italian');assert.equal(h.searches[0].includedType,'italian_restaurant');assert.equal(h.searches[0].useStrictTypeFiltering,true);assert.equal(h.searches[0].maxResultCount,12);assert.deepEqual(h.searches[0].fields,['id','displayName','formattedAddress','location','primaryType','primaryTypeDisplayName']);assert.equal(h.navigations.length,1);assert.deepEqual(h.navigations[0].location,{lat:43.8,lng:-79.5});assert.equal(h.navigations[0].type,'restaurant');h.stop();}
});
test('current restaurant failure, unavailable library and empty results remain retryable',async()=>{
 for(const settings of [{searchPlaces:async n=>{if(n===1)throw Error('Synthetic outage');return {places:[place()]};}},{searchPlaces:async n=>({places:n===1?[]:[place()]})}]){const h=harness(settings);await h.submit();assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);assert.ok(nodes(h.render(),n=>n.props?.role==='alert').length);await h.submit();assert.match(h.text,/Restaurant new/);h.stop();}
 const h=harness({placesLoaded:false});await h.submit();assert.match(h.text,/Google Places is still loading/);assert.equal(h.imports.length,0);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);h.stop();
});
for(const kind of ['restaurants','events']){
 test(kind+': unmounted successes and failures cannot write or navigate',async()=>{
  for(const failure of [false,true]){const pending=later(),h=harness({mode:kind,searchPlaces:()=>pending.promise,readEvents:()=>pending.promise}),work=kind==='restaurants'?h.adventure():h.submit();await tick();h.stop();const n=h.writes.length;if(failure)pending.reject(Error('OLD PRIVATE ERROR'));else pending.resolve(kind==='restaurants'?{places:[place()]}:{data:[event()]});await work;assert.equal(h.writes.length,n);assert.equal(h.navigations.length,0);}
 });
 test(kind+': StrictMode cleanup/setup rejects old work and leaves search usable',async()=>{
  const pending=later(),h=harness({mode:kind,searchPlaces:async n=>n===1?pending.promise:{places:[place('current')]},readEvents:async n=>n===1?pending.promise:{data:[event(2)]}}),work=h.submit();await tick();h.replay();const n=h.writes.length;pending.resolve(kind==='restaurants'?{places:[place('obsolete')]}:{data:[event(1,'Obsolete event')]});await work;assert.equal(h.writes.length,n);await h.submit();assert.equal(kind==='restaurants'?h.searches.length:h.eventReads.length,2);assert.doesNotMatch(h.text,/Restaurant obsolete|Obsolete event/);h.stop();
 });
}
test('event filter changes retire old responses without clearing a newer pending search',async()=>{
 for(const [label,value] of [['Event name, venue, or area','Music'],['Event category','festival'],['Event date','2030-11-01']]){const old=later(),current=later(),h=harness({mode:'events',readEvents:async n=>n===1?old.promise:current.promise}),a=h.submit();h.change(label,value);h.render();const b=h.submit(),n=h.writes.length;old.resolve({data:[event(1,'Obsolete event')]});await a;assert.equal(h.writes.length,n);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,true);current.resolve({data:[event(2)]});await b;assert.match(h.text,/Music Festival/);assert.doesNotMatch(h.text,/Obsolete event/);h.stop();}
});
test('event duplicate submits make one bounded published-event read',async()=>{
 const pending=later(),h=harness({mode:'events',readEvents:()=>pending.promise}),old=h.find(n=>n.type==='form').props.onSubmit,a=old({preventDefault(){}}),b=old({preventDefault(){}});assert.equal(h.eventReads.length,1);assert.equal(h.eventReads[0].limit,100);assert.deepEqual(h.eventReads[0].equal,['status','published']);assert.equal(h.eventReads[0].table,'events');assert.deepEqual(h.eventReads[0].order,['starts_at',{ascending:true}]);pending.resolve({data:[event()]});await Promise.all([a,b]);h.stop();
});
test('event mode A to B to A rejects old failures and queued submit callbacks',async()=>{
 const pending=later(),h=harness({mode:'events',readEvents:()=>pending.promise}),old=h.find(n=>n.type==='form').props.onSubmit,a=old({preventDefault(){}});h.setMode('restaurants');h.setMode('events');const n=h.writes.length;pending.reject(Error('Obsolete event failure'));await a;await old({preventDefault(){}});assert.equal(h.writes.length,n);assert.equal(h.eventReads.length,1);assert.doesNotMatch(h.text,/Events could not be loaded/);h.stop();
});
test('normal event filters and destination selection retain the selected event schedule',async()=>{
 const h=harness({mode:'events',readEvents:async()=>({data:[event(1),event(2,'Other concert','concert')]})});h.change('Event name, venue, or area','Music');h.render();h.change('Event category','festival');h.render();h.change('Event date','2030-11-01');await h.submit();assert.match(h.text,/Music Festival/);assert.doesNotMatch(h.text,/Other concert/);const select=h.find(n=>n.type==='button'&&n.props.children==='Find parking nearby').props.onClick;select();select();assert.equal(h.navigations.length,1);assert.equal(h.navigations[0].type,'event');assert.equal(h.navigations[0].destination.id,1);assert.equal(h.navigations[0].destination.startsAt,'2030-11-01T20:00:00.000Z');h.stop();
});
test('event errors and empty results unlock explicit retry',async()=>{
 for(const first of [{error:{message:'Denied'}},{data:[]},null]){const h=harness({mode:'events',readEvents:async n=>{if(n===1){if(first===null)throw Error('Network');return first;}return {data:[event()]};}});await h.submit();assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);assert.ok(nodes(h.render(),n=>n.props?.role==='alert').length);await h.submit();assert.match(h.text,/Music Festival/);h.stop();}
});
