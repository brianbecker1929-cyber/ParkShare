import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {before,test} from 'node:test';
import React from 'react';
import {transform} from 'esbuild';
let factory;
before(async()=>{
  const source=await readFile(process.env.PARKING_MAP_SOURCE || new URL('../src/App.jsx',import.meta.url),'utf8');
  const start=source.indexOf('function ListingsMap(');
  const code=source.slice(start,source.indexOf('// ─── Messaging Panel',start)).replaceAll('import.meta.env.VITE_GOOGLE_MAPS_API_KEY','"synthetic"');
  const compiled=await transform(code,{loader:'jsx',jsx:'transform'});
  factory=new Function('deps',`const {React,useState,useRef,useEffect,useJsApiLoader,GOOGLE_MAPS_LIBRARIES,GoogleMap,OverlayView,ParkingMapPin,ListingThumb,WalkingTimeLabel,C,MAP_STYLE,money,window}=deps;${compiled.code};return ListingsMap;`);
});
const first={id:'db-1',lat:43.7,lng:-79.4,title:'Private parking available',price:10};
const second={...first,id:'db-2',lat:43.71,lng:-79.41};
function nodes(root){return !root||typeof root!=='object'?[]:Array.isArray(root)?root.flatMap(nodes):[root,...nodes(root.props?.children)];}
function harness({mobile=false,loaded=true,selected=null,listings=[first,second],userLoc=null}={}){
  const states=[],refs=[],effects=[],frames=new Map(),calls=[];let si,ri,ei,dirty,root,frame=0;
  let props={listings,selected,userLoc,onSelect:()=>{},onViewListing:()=>{},onPreviewRoute:()=>{}};
  const GoogleMap=()=>null,OverlayView=()=>null,ParkingMapPin=()=>null;
  const map={panTo:p=>calls.push(['panTo',p]),panBy:(...p)=>calls.push(['panBy',...p]),setZoom:z=>calls.push(['zoom',z]),fitBounds:b=>calls.push(['bounds',b.points])};
  const deps={React,GoogleMap,OverlayView,ParkingMapPin,ListingThumb:()=>null,WalkingTimeLabel:()=>null,C:{},MAP_STYLE:[],money:x=>`$${x}`,GOOGLE_MAPS_LIBRARIES:[],
    useState(initial){const i=si++;if(!(i in states))states[i]=initial;return [states[i],v=>{states[i]=v;dirty=true;}];},
    useRef(initial){const i=ri++;return refs[i] ||= {current:initial};},
    useEffect(fn,dependencies){const i=ei++,old=effects[i];if(!old||dependencies.some((d,j)=>!Object.is(d,old.dependencies[j])))effects[i]={fn,dependencies,pending:true,cleanup:old?.cleanup};},
    useJsApiLoader:()=>({isLoaded:loaded}),
    window:{google:{maps:{LatLngBounds:class{points=[];extend(p){this.points.push(p);}}}},matchMedia:()=>({matches:mobile}),
      requestAnimationFrame:fn=>{frames.set(++frame,fn);return frame;},cancelAnimationFrame:id=>frames.delete(id)},
  };
  const MapView=factory(deps);
  function render(){for(let pass=0;pass<20;pass++){si=ri=ei=0;dirty=false;root=MapView(props);for(const effect of effects){if(effect.pending){effect.cleanup?.();effect.pending=false;effect.cleanup=effect.fn();}}if(!dirty)return;}throw Error('Unstable map effects');}
  render();
  return {calls,map,nodes:()=>nodes(root),google:()=>nodes(root).find(n=>n.type===GoogleMap)?.props,
    pins:()=>nodes(root).filter(n=>n.type===ParkingMapPin).map(n=>n.props),
    ready(){nodes(root).find(n=>n.type===GoogleMap).props.onLoad(map);render();},
    update(next){props={...props,...next};render();},
    loaded(){loaded=true;render();},
    frames(){for(const [id,fn] of frames){frames.delete(id);fn();}},
  };
}
test('desktop selection pans to the matching non-first pin, even with a destination',()=>{
  const h=harness({userLoc:{lat:43.8,lng:-79.5}});h.ready();h.calls.length=0;
  h.update({selected:second});assert.deepEqual(h.calls,[['panTo',{lat:second.lat,lng:second.lng}]]);
  assert.deepEqual(h.pins().map(p=>p.selected),[false,true]);
});
test('map readiness centers a selection made while Google Maps was loading',()=>{
  const h=harness({loaded:false,selected:second});assert.equal(h.google(),undefined);
  h.loaded();h.ready();assert.deepEqual(h.calls,[['panTo',{lat:second.lat,lng:second.lng}]]);
});
test('rerenders preserve the initial center object and do not reset a selected camera',()=>{
  const h=harness();const center=h.google().center;h.ready();h.update({selected:second});h.calls.length=0;
  h.update({listings:[{...first},{...second}],selected:{...second}});
  assert.equal(h.google().center,center);assert.deepEqual(h.calls,[]);
});
test('tablet/mobile selection reserves room for its preview and cancels stale offsets',()=>{
  const h=harness({mobile:true});h.ready();h.update({selected:first});h.update({selected:second});h.frames();
  assert.deepEqual(h.calls.filter(c=>c[0]==='panBy'),[['panBy',0,-105]]);
  assert.deepEqual(h.calls.filter(c=>c[0]==='panTo').at(-1),['panTo',{lat:second.lat,lng:second.lng}]);
});
test('dismissing the preview restores the destination anchor',()=>{
  const destination={lat:43.8,lng:-79.5};const h=harness({selected:second,userLoc:destination});h.ready();h.calls.length=0;
  h.update({selected:null});assert.deepEqual(h.calls,[['panTo',destination],['zoom',14]]);
});
test('without a selection or destination the map fits all finite listing coordinates',()=>{
  const h=harness({listings:[first,second,{...first,id:'invalid',lat:NaN}]});h.ready();
  assert.deepEqual(h.calls,[['bounds',[{lat:first.lat,lng:first.lng},{lat:second.lat,lng:second.lng}]]]);
});
test('removed selections cannot leave a preview for a filtered-out listing',()=>{
  const h=harness({selected:second});h.ready();h.update({listings:[first]});
  assert.equal(h.pins().some(p=>p.selected),false);
  assert.equal(h.nodes().some(n=>n.props?.className==='ps-mobile-map-listing-preview'),false);
});
test('changed coordinates for the same selected ID update the camera',()=>{
  const h=harness({selected:second});h.ready();h.calls.length=0;
  h.update({listings:[first,{...second,lat:43.72}]});assert.deepEqual(h.calls,[['panTo',{lat:43.72,lng:second.lng}]]);
});

test('sorting markers does not refit the map or reset a manually panned centre',()=>{
 const h=harness();h.ready();h.calls.length=0;h.update({listings:[second,first]});assert.deepEqual(h.calls,[]);
});
test('map idle publishes the actual centre independently of device location',()=>{
 const h=harness();h.ready();let centre;
 h.map.getCenter=()=>({lat:()=>45.8,lng:()=>24.9});
 h.update({onSearchCenterChange:value=>centre=value});h.google().onIdle();
 assert.deepEqual(centre,{lat:45.8,lng:24.9});
});
