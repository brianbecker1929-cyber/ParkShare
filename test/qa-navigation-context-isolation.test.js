import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {buildNavigationUrl} from '../src/lib/navigation.js';
const source=await readFile(process.env.QA_NAVIGATION_CONTEXT_SOURCE_FILE||new URL('../src/App.jsx',import.meta.url),'utf8');
const destination=id=>({id,title:id+' PRIVATE TITLE',address:id+' PRIVATE ADDRESS',lat:43.7,lng:-79.4,photos:['PRIVATE PHOTO'],vehicle:{plate:'PRIVATE PLATE'}});
const currentStart=source.indexOf('function navigationDestination(');
let code;
if(currentStart>=0)code=source.slice(currentStart,source.indexOf('// ─── App ─',currentStart));
else{
 const a=source.indexOf('  const previewParkingRoute = (listing) => {',source.indexOf('export default function App(')),b=source.indexOf('  // Restore the selected ParkShare page',a);
 // Execute the old root's actual state and callbacks to reproduce its races.
 code='function useParkingNavigation(user,preferredNavigationProvider,setPreferredNavigationProvider){const [navigationRequest,setNavigationRequest]=useState(null);'+source.slice(a,b)+';return {request:navigationRequest,preview:previewParkingRoute,navigate:navigateToParking,changeApp:changeNavigationApp,choose:chooseNavigationProvider,close:()=>setNavigationRequest(null),clear:()=>setNavigationRequest(null)};}';
}
function harness({preferred=null,apple=false}={}){
 const slots=[],launches=[],saved=[],preferences=[];let cursor=0,changed=false,owner='A',result;
 const depsChanged=(a,b)=>!a||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));
 const setPreferred=value=>{preferred=value;preferences.push(value);};
 const providers=()=>[{id:'waze'},{id:'google'},...(apple?[{id:'apple'}]:[])];
 const values={useState:initial=>{const n=cursor++;if(!slots[n])slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{const next=typeof v==='function'?v(slots[n].value):v;if(next!==slots[n].value){slots[n].value=next;changed=true;}}];},useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},useCallback:(fn,deps)=>{const n=cursor++;if(!slots[n]||depsChanged(slots[n].deps,deps))slots[n]={value:fn,deps};return slots[n].value;},getAvailableNavigationProviders:providers,savePreferredNavigationProvider:id=>{saved.push(id);return true;},openNavigation:(listing,provider)=>{launches.push({listing,provider,url:buildNavigationUrl(listing.address,listing.lat,listing.lng,apple?'iPhone':'Android',provider)});return true;}};
 const hook=new Function(...Object.keys(values),code+';return useParkingNavigation;')(...Object.values(values));
 function render(id=owner){owner=id;let turns=0;do{cursor=0;changed=false;result=hook(id?{id}:null,preferred,setPreferred);assert.ok(++turns<5,'Render adjustment must converge');}while(changed);return result;}
 return {render,get result(){return result;},launches,saved,preferences};
}
const chooserSource=source.slice(source.indexOf('function NavigationChooser('),source.indexOf('function RidesharePickupCard('));
const chooserBuilt=await transform(chooserSource,{loader:'jsx'});
const Chooser=new Function('React','C','Modal','getAvailableNavigationProviders',chooserBuilt.code+';return NavigationChooser;')(React,{},({children})=>React.createElement('div',null,children),()=>[{id:'waze',label:'Waze'},{id:'google',label:'Google Maps'}]);
const markup=request=>renderToStaticMarkup(React.createElement(Chooser,{request,onChoose:()=>{},onClose:()=>{}}));

test('account change immediately removes the previous private navigation address from rendered chooser',()=>{
 const h=harness();h.render('A').changeApp(destination('A'));assert.match(markup(h.render().request),/A PRIVATE ADDRESS/);assert.equal(h.render('B').request,null);assert.equal(markup(h.result.request),'');
});
test('sign-out and anonymous-to-signed-in transitions clear navigation destinations',()=>{
 const h=harness();h.render('A').preview(destination('A'));h.render('A');assert.equal(h.render(null).request,null);h.result.preview({id:1,title:'Public',address:'Approximate area',lat:43.7,lng:-79.4});assert.ok(h.render(null).request);assert.equal(h.render('B').request,null);
});
test('A to B to A cannot resurrect or open a previous account destination',()=>{
 const h=harness({preferred:'waze'}),old=h.render('A');old.changeApp(destination('A'));const chooser=h.render('A');h.render('B');h.render('A');old.preview(destination('A'));old.navigate(destination('A'));chooser.choose('waze');assert.equal(h.render('A').request,null);assert.equal(h.launches.length,0);assert.equal(h.saved.length,0);
});
test('stale preferred-app callback cannot export a previous account address after account switch',()=>{
 const h=harness({preferred:'waze'}),old=h.render('A');h.render('B');old.navigate(destination('A'));assert.equal(h.launches.length,0);assert.equal(h.render('B').request,null);assert.equal(h.preferences.length,0);
});
test('old provider or close callback cannot launch or dismiss a replacement destination',()=>{
 const h=harness();h.render('A').changeApp(destination('FIRST'));const old=h.render('A');old.changeApp(destination('SECOND'));const newer=h.render('A');old.choose('google');old.close();assert.equal(h.launches.length,0);assert.equal(h.saved.length,0);assert.equal(h.render().request.listing.address,'SECOND PRIVATE ADDRESS');newer.choose('waze');assert.equal(h.launches[0].listing.address,'SECOND PRIVATE ADDRESS');assert.equal(h.render().request,null);
});
test('choosing twice before the next React render opens one map and saves one preference',()=>{
 const h=harness();h.render().preview(destination('A'));const choose=h.render().choose;choose('google');choose('waze');assert.equal(h.launches.length,1);assert.deepEqual(h.saved,['google']);assert.deepEqual(h.preferences,['google']);assert.equal(h.render().request,null);
});
test('closing invalidates a queued provider selection before another render',()=>{
 const h=harness();h.render().changeApp(destination('A'));const active=h.render();active.close();active.choose('waze');assert.equal(h.launches.length,0);assert.equal(h.saved.length,0);assert.equal(h.render().request,null);
});
test('initial Back/Forward clear always closes the latest request and rejects queued selection',()=>{
 const h=harness(),initial=h.render('A');initial.preview(destination('A'));const a=h.render('A');h.render('B');h.result.preview(destination('B'));const b=h.render('B');assert.equal(initial.clear,b.clear);initial.clear();b.choose('google');a.choose('waze');assert.equal(h.render('B').request,null);assert.equal(h.launches.length,0);assert.equal(h.saved.length,0);
});
test('chooser captures a minimal immutable destination rather than the mutable source record',()=>{
 const listing=destination('A'),h=harness();h.render().preview(listing);listing.address='CHANGED';listing.lat=1;const request=h.render().request;assert.equal(request.listing.address,'A PRIVATE ADDRESS');assert.equal(request.listing.lat,43.7);assert.deepEqual(Object.keys(request.listing).sort(),['address','id','lat','lng','title']);assert.doesNotMatch(JSON.stringify(request),/PRIVATE PHOTO|PRIVATE PLATE/);
});
test('public route preview still asks for an app and never opens a map before a choice',()=>{
 const h=harness({preferred:'waze'});h.render(null).preview({id:1,title:'Public',address:'Approximate area',lat:43.7,lng:-79.4});const request=h.render(null).request;assert.equal(request.mode,'preview');assert.equal(h.launches.length,0);h.result.choose('google');assert.equal(h.launches.length,1);assert.match(h.launches[0].url,/destination=43\.7%2C-79\.4/);
});
test('current-account Navigate uses an available saved provider and preserves the Waze destination',()=>{
 const h=harness({preferred:'waze'});h.render('A').navigate(destination('A'));assert.equal(h.launches.length,1);assert.equal(h.launches[0].provider,'waze');assert.match(h.launches[0].url,/q=A%20PRIVATE%20ADDRESS/);assert.match(h.launches[0].url,/ll=43\.7%2C-79\.4/);assert.equal(h.render('A').request,null);assert.equal(h.saved.length,0);
});
test('unavailable saved app falls back to chooser and unsupported choices cannot mutate preference',()=>{
 const h=harness({preferred:'apple'});h.render().navigate(destination('A'));const active=h.render();assert.equal(active.request.mode,'navigate');for(const provider of ['apple','unknown','constructor'])active.choose(provider);assert.equal(h.launches.length,0);assert.equal(h.saved.length,0);assert.equal(h.preferences.length,0);assert.ok(h.render().request);
});
test('Apple choice is preserved on supported devices and a profile refresh retains the current request',()=>{
 const h=harness({apple:true});h.render('A').changeApp(destination('A'));const one=h.render('A');const two=h.render('A');assert.equal(two.request,one.request);two.choose('apple');assert.equal(h.launches.length,1);assert.match(h.launches[0].url,/maps\.apple\.com/);assert.deepEqual(h.saved,['apple']);
});
test('changing identity clears the chooser while retaining a browser-wide app preference',()=>{
 const h=harness();h.render('A').changeApp(destination('A'));h.render('A').choose('google');h.render('A');h.render('B').navigate(destination('B'));assert.equal(h.launches.length,2);assert.equal(h.launches[1].provider,'google');assert.equal(h.launches[1].listing.address,'B PRIVATE ADDRESS');
});
test('invalid destinations and provider selection with no request perform no external action',()=>{
 const h=harness(),empty=h.render();empty.choose('google');empty.preview(null);empty.navigate(undefined);empty.changeApp('bad');assert.equal(h.render().request,null);assert.equal(h.launches.length,0);assert.equal(h.saved.length,0);
});
test('fresh navigation action after a dismissal still works and same-ID replacement gets a new key',()=>{
 const h=harness();h.render().changeApp(destination('A'));const first=h.render(),key=first.requestKey;first.close();h.render().changeApp({...destination('A'),address:'NEW ADDRESS'});const second=h.render();assert.notEqual(second.requestKey,key);assert.equal(second.request.listing.address,'NEW ADDRESS');second.choose('google');assert.equal(h.launches[0].listing.address,'NEW ADDRESS');
});
test('root chooser uses the scoped request, replacement key and scoped close handler',async()=>{
 const a=source.indexOf('<NavigationChooser\n'),tag=source.slice(a,source.indexOf('/>',a)+2),built=await transform('function Parent({navigationRequestKey}){return '+tag+';}',{loader:'jsx'});
 const values={React,NavigationChooser:()=>null,navigationRequest:{listing:destination('A')},preferredNavigationProvider:'waze',chooseNavigationProvider:()=>{},closeNavigationRequest:()=>{},setNavigationRequest:()=>{}};
 const Parent=new Function(...Object.keys(values),built.code+';return Parent;')(...Object.values(values));const first=Parent({navigationRequestKey:1}),second=Parent({navigationRequestKey:2});assert.notEqual(first.key,second.key);assert.equal(first.props.onClose,values.closeNavigationRequest);
});
test('actual initial browser history listener calls a stable global clear',()=>{
 const a=source.indexOf('  useEffect(() => {\n    const handlePopState =',source.indexOf('export default function App(')),b=source.indexOf('  // Keep titles',a),code=source.slice(a,b);let run,listener,removed,clears=0;
 const values={useEffect:fn=>{run=fn;},window:{location:{pathname:'/parking',search:''},addEventListener:(name,fn)=>{assert.equal(name,'popstate');listener=fn;},removeEventListener:(name,fn)=>{assert.equal(name,'popstate');removed=fn;}},getRouteFromPath:()=>({screen:'app',tab:'Browse'}),navigationAnchorRef:{current:null},setScreen:()=>{},setTab:()=>{},setLegalSection:()=>{},setMessageThread:()=>{},setMessageBookingId:()=>{},parseMessageBookingId:()=>null,clearNavigationRequest:()=>{clears++;},setNavigationRequest:()=>{throw Error('History must not capture the initial scoped request setter');}};
 new Function(...Object.keys(values),code)(...Object.values(values));const stop=run();listener();assert.equal(clears,1);stop();assert.equal(removed,listener);
});
