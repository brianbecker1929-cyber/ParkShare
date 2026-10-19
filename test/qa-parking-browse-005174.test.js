import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {before,test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import * as search from '../src/lib/parkingSearch.js';
import {buildWalkingLabel,estimateWalkingMinutes} from '../src/lib/walkingTime.js';
let factory;
before(async()=>{
  const source=await readFile(process.env.PARKING_BROWSE_SOURCE || new URL('../src/App.jsx',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function BrowseView('),source.indexOf('// ─── Host Dashboard',source.indexOf('function BrowseView(')))
    .replaceAll('import.meta.env.VITE_GOOGLE_MAPS_API_KEY','"synthetic"');
  const compiled=await transform(code,{loader:'jsx',jsx:'transform'});
  factory=new Function('deps',`const {${[
    'React','useState','useRef','useEffect','useJsApiLoader','GOOGLE_MAPS_LIBRARIES','useAllListings',
    'computeWalkingRoutes','buildWalkingLabel','estimateWalkingMinutes',...Object.keys(search),
    'milesBetween','C','ListingsMap','ListingThumb','PriceTag','WalkingTimeLabel','ListingDetail','Btn','normalizeEventRow',
    'supabase','window','google','navigator','setTimeout','clearTimeout',
  ].join(',')}}=deps;${compiled.code};return {BrowseView,ParkingSearchEmptyState:typeof ParkingSearchEmptyState === "function" ? ParkingSearchEmptyState : null};`);
});
const toronto={lat:43.8,lng:-79.5};
const near={id:'db-1',...toronto,title:'Private parking available',address:'Approximate location',locationPrecision:'approximate',price:10};
const far={...near,id:'db-2',lat:45.4,lng:-75.7};
const treeNodes=root=>{
  const result=[];
  function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}
    result.push(node);visit(node.props?.children);}
  visit(root);return result;
};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness({listings=[near,far],props={},route=async()=>({}),place=null,autocomplete=null,loaded=true,listingError=null,listingLoading=false}={}){
  const state=[],refs=[],effects=[],timers=new Map();let si=0,ri=0,ei=0,id=0,dirty=false,root,mapProps,positionSuccess,positionError;
  const routesCalled=[];
  const Stub=({children})=>React.createElement('span',null,children);
  const Maps=props=>{mapProps=props;return React.createElement('div',{'data-testid':'map','data-ids':props.listings.map(l=>l.id).join(',')});};
  const google={maps:{importLibrary:async()=>({AutocompleteSessionToken:class {},AutocompleteSuggestion:{fetchAutocompleteSuggestions:autocomplete || (async()=>({suggestions:place?[{placePrediction:place}]:[]}))}})}};
  const deps={React,...search,buildWalkingLabel,estimateWalkingMinutes,
    useState(initial){const index=si++;if(!(index in state))state[index]=initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;dirty=true;}];},
    useRef(initial){const index=ri++;if(!(index in refs))refs[index]={current:initial};return refs[index];},
    useEffect(fn,dependencies){const index=ei++;const old=effects[index];if(!old||dependencies.some((d,i)=>!Object.is(d,old.dependencies[i])))effects[index]={fn,dependencies,pending:true,cleanup:old?.cleanup};},
    useJsApiLoader:()=>({isLoaded:loaded}),GOOGLE_MAPS_LIBRARIES:[],
    useAllListings:()=>({listings,loading:listingLoading,error:listingError,refresh:()=>{}}),
    computeWalkingRoutes:async(items,destination)=>{routesCalled.push({items,destination});return route(items,destination);},
    milesBetween:(lat,lng,otherLat,otherLng)=>search.parkingDistanceKm({lat,lng},{lat:otherLat,lng:otherLng})/1.60934,
    C:{white:'#fff',navy:'#000',concrete:'#ddd',muted:'#777',warmWhite:'#fafafa',red:'#f00'},
    ListingsMap:Maps,ListingThumb:Stub,PriceTag:Stub,WalkingTimeLabel:({label})=>React.createElement('span',null,label),ListingDetail:Stub,Btn:Stub,
    normalizeEventRow:x=>x,
    supabase:{from:()=>({select:()=>({eq:async()=>({data:[]})})})},
    window:{google},google,navigator:{geolocation:{getCurrentPosition:(ok,fail)=>{positionSuccess=ok;positionError=fail;}}},
    setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key),
  };
  const {BrowseView,ParkingSearchEmptyState}=factory(deps);
  function render(){si=ri=ei=0;dirty=false;root=BrowseView(props);return root;}
  function settle(){for(let pass=0;pass<20;pass++){render();for(const effect of effects){if(effect.pending){effect.cleanup?.();effect.pending=false;effect.cleanup=effect.fn();}}if(!dirty)return;}throw Error('Unstable component effects');}
  settle();
  return {
    render:()=>{settle();return root;},
    nodes:()=>treeNodes(root),
    html:()=>{settle();mapProps=null;return renderToStaticMarkup(root);},
    map:()=>{settle();renderToStaticMarkup(root);return mapProps;},
    input(value){treeNodes(root).find(n=>n.type==='input').props.onChange({target:{value}});settle();},
    async suggest(){for(const [key,fn] of [...timers]){timers.delete(key);await fn();}settle();},
    pick(){const node=treeNodes(root).find(n=>n.props?.onClick&&treeNodes(n).some(c=>c.props?.children==='📍')&&n.type==='div');assert.ok(node,'suggestion exists');const promise=node.props.onClick();settle();return promise;},
    chooseView(view){treeNodes(root).find(n=>n.type==='button'&&n.props['aria-label']===view).props.onClick();settle();},
    locate(){treeNodes(root).find(n=>n.props?.className==='ps-browse-location-button').props.onClick();settle();},
    position(point){positionSuccess({coords:{latitude:point.lat,longitude:point.lng}});settle();},
    denied(){positionError();settle();},
    clear(){treeNodes(root).find(n=>n.type===ParkingSearchEmptyState).props.onClear();settle();},
    async flush(){settle();await new Promise(resolve=>setImmediate(resolve));settle();},
    routesCalled,
  };
}
for(const view of ['Split map and list view','List view','Map view']){
  test(`selected remote destination displays no nearby parking in ${view}`,()=>{
    const h=harness({props:{initialLocation:{lat:49,lng:-123},initialQuery:'Vancouver'}});h.chooseView(view);
    const html=h.html();assert.match(html,/No parking nearby/);assert.match(html,/within 5 km/);
    assert.doesNotMatch(html,/ps-browse-listing-card/);if(view!=='List view')assert.equal(h.map().listings.length,0);
  });
  test(`unmatched My location search has a visible empty state in ${view}`,()=>{
    const h=harness();h.locate();h.position(toronto);h.input('zz-no-match');h.chooseView(view);
    assert.match(h.html(),/No parking matches your search/);assert.match(h.html(),/within 5 km of your location/);
  });
}
test('destination limits list/map to nearby rows and marks coarse walking estimates',()=>{
  const h=harness({props:{initialLocation:toronto,initialQuery:'Mall'}});
  assert.deepEqual(h.map().listings.map(l=>l.id),['db-1']);
  assert.match(h.html(),/approximate area/);assert.equal(h.routesCalled.length,0);
});
test('clearing an empty search restores browse and removes map anchor',()=>{
  const h=harness({props:{initialLocation:{lat:49,lng:-123}}});h.clear();
  assert.equal(h.map().listings.length,2);assert.equal(h.map().userLoc,null);assert.doesNotMatch(h.html(),/No parking nearby/);
});
test('typing after selecting a destination clears that destination instead of retaining its radius',()=>{
  const h=harness({props:{initialLocation:{lat:49,lng:-123}}});h.input('Private');
  assert.equal(h.map().listings.length,2);assert.equal(h.map().userLoc,null);
});
test('My location after a selected destination requests device position',()=>{
  const h=harness({props:{initialLocation:{lat:49,lng:-123}}});h.locate();h.position(toronto);
  assert.equal(h.map().userLoc.lat,toronto.lat);assert.equal(h.map().listings.length,1);
  assert.match(h.html(),/km from your location/);
});
test('delayed geolocation cannot replace a newer text search',()=>{
  const h=harness();h.locate();h.input('zz-no-match');h.position(toronto);
  assert.equal(h.map().userLoc,null);assert.match(h.html(),/No parking matches your search/);
});
test('geolocation denial displays actionable error without fabricated location',()=>{
  const h=harness();h.locate();h.denied();assert.match(h.html(),/check your browser\/location permissions/);assert.equal(h.map().userLoc,null);
});
test('delayed Place details cannot override newer text or restore destination selection',async()=>{
  const wait=deferred();const place={mainText:{text:'Old mall'},toPlace:()=>({fetchFields:()=>wait.promise,location:{lat:()=>43.8,lng:()=>-79.5}})};
  const h=harness({place});h.input('old mall');await h.suggest();const pending=h.pick();
  h.input('zz-no-match');wait.resolve();await pending;await h.flush();
  assert.match(h.html(),/No parking matches your search/);assert.equal(h.map().userLoc,null);
});
test('selected suggestion uses fetched coordinates and routes only nearby permitted listings',async()=>{
  const exact={...near,locationPrecision:'exact'};
  const place={mainText:{text:'Mall'},toPlace:()=>({fetchFields:async()=>{},displayName:'Mall',location:{lat:()=>43.8,lng:()=>-79.5}})};
  const h=harness({listings:[exact,far],place,route:async()=>({'db-1':{minutes:8,distanceMeters:600}})});
  h.input('mall');await h.suggest();await h.pick();await h.flush();
  assert.deepEqual(h.routesCalled[0].items.map(l=>l.id),['db-1']);assert.equal(h.routesCalled[0].destination.lat,43.8);
  assert.match(h.html(),/8 min walk/);
});
test('a route response from an old destination cannot show during a new search',async()=>{
  const wait=deferred();const h=harness({listings:[{...near,locationPrecision:'exact'}],props:{initialLocation:toronto},route:()=>wait.promise});
  assert.match(h.html(),/Calculating walk/);h.input('zz-no-match');wait.resolve({'db-1':{minutes:99,distanceMeters:1000}});await h.flush();
  assert.doesNotMatch(h.html(),/99 min/);assert.match(h.html(),/No parking matches/);
});
test('missing Place coordinates show error, not results from the previous destination',async()=>{
  const h=harness({place:{mainText:{text:'Missing'},toPlace:()=>({fetchFields:async()=>{}})}});
  h.input('missing');await h.suggest();await h.pick();await h.flush();
  assert.match(h.html(),/Couldn&#x27;t locate this destination/);assert.equal(h.map().userLoc,null);
});
test('loading and network errors have their own states, never a false no-nearby result',()=>{
  const loading=harness({listingLoading:true,props:{initialLocation:toronto}}).html();
  assert.match(loading,/Loading available driveways/);assert.doesNotMatch(loading,/No parking nearby/);
  const error=harness({listingError:'Synthetic fetch failure',props:{initialLocation:toronto}}).html();
  assert.match(error,/Driveways couldn&#x27;t be loaded/);assert.doesNotMatch(error,/No parking nearby/);
});
test('autocomplete cannot repopulate suggestions after the search has been cleared',async()=>{
  const wait=deferred();let called=false;
  const h=harness({autocomplete:()=>{called=true;return wait.promise;}});h.input('zz-no-match');
  const pending=h.suggest();await Promise.resolve();assert.equal(called,true);h.clear();
  wait.resolve({suggestions:[{placePrediction:{mainText:{text:'Old mall'}}}]});await pending;await h.flush();
  assert.equal(h.map().userLoc,null);assert.equal(h.map().listings.length,2);assert.doesNotMatch(h.html(),/Old mall/);
});
test('sorting cannot bring distant listings back into destination results',()=>{
  const h=harness({props:{initialLocation:toronto}});
  for(const sort of ['price','rating','distance']){
    h.nodes().find(n=>n.type==='select').props.onChange({target:{value:sort}});h.render();
    assert.deepEqual(h.map().listings.map(l=>l.id),['db-1']);
  }
});
test('query with no results has an empty state without device location',()=>{
  const h=harness();h.input('zz-no-match');assert.match(h.html(),/No parking matches your search/);
});
test('destination changes cannot reuse a previous walking response for the same listing',async()=>{
  const old=deferred();let calls=0;
  const place={mainText:{text:'New mall'},toPlace:()=>({fetchFields:async()=>{},displayName:'New mall',location:{lat:()=>43.801,lng:()=>-79.501}})};
  const h=harness({listings:[{...near,locationPrecision:'exact'}],props:{initialLocation:toronto},place,
    route:()=>++calls===1?old.promise:Promise.resolve({'db-1':{minutes:4,distanceMeters:300}})});
  h.input('new mall');await h.suggest();await h.pick();await h.flush();
  assert.equal(h.routesCalled.length,2);assert.match(h.html(),/4 min walk/);
  old.resolve({'db-1':{minutes:99,distanceMeters:10000}});await h.flush();
  assert.match(h.html(),/4 min walk/);assert.doesNotMatch(h.html(),/99 min/);
});

const cards=h=>h.nodes().filter(n=>n.props?.['data-listing-id']);
const selectedCards=h=>cards(h).filter(n=>n.props.className.includes('is-selected')).map(n=>n.props['data-listing-id']);
test('BUG-005173: choosing a non-first pin selects its matching card despite identical titles',()=>{
  const h=harness();h.map().onSelect(far);h.render();
  assert.deepEqual(selectedCards(h),['db-2']);assert.equal(h.map().selected.id,'db-2');
  cards(h)[0].props.onMouseEnter?.();h.render();
  assert.deepEqual(selectedCards(h),['db-2']);assert.equal(h.map().selected.id,'db-2');
});
test('BUG-005171: card click and keyboard-accessible selection target the same map listing',()=>{
  const h=harness();cards(h)[1].props.onClick();h.render();assert.equal(h.map().selected.id,'db-2');
  const button=h.nodes().find(n=>n.type==='button'&&n.props.className==='ps-browse-listing-main');
  assert.equal(button.props['aria-pressed'],false);button.props.onClick({stopPropagation(){}});h.render();
  assert.equal(h.map().selected.id,'db-1');assert.deepEqual(selectedCards(h),['db-1']);
});
test('map selection survives sorting and view toggles and clears on search/dismissal',()=>{
  const h=harness({listings:[{...near,price:20},{...far,price:5}]});h.map().onSelect(far);h.render();
  h.nodes().find(n=>n.type==='select').props.onChange({target:{value:'price'}});h.render();
  assert.equal(cards(h)[0].props['data-listing-id'],'db-2');assert.deepEqual(selectedCards(h),['db-2']);
  h.chooseView('List view');h.chooseView('Map view');assert.equal(h.map().selected.id,'db-2');
  h.map().onSelect(null);h.render();assert.equal(h.map().selected,null);
  h.chooseView('Split map and list view');assert.deepEqual(selectedCards(h),[]);
  h.map().onSelect(far);h.render();h.input('zz-no-match');assert.equal(h.map().selected,null);
});
test('pin selection scrolls the matching offscreen card inside the desktop list only',()=>{
  const h=harness();const column=h.nodes().find(n=>n.props?.className==='ps-browse-listing-column');
  column.ref.current={scrollHeight:1000,clientHeight:300};const calls=[];
  cards(h)[1].ref({scrollIntoView:options=>calls.push(options)});
  h.map().onSelect(far);h.render();assert.deepEqual(calls,[{block:'nearest',inline:'nearest'}]);
  column.ref.current={scrollHeight:1000,clientHeight:1000};h.map().onSelect(far);h.render();assert.equal(calls.length,1);
});
