import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {validateBookingVehicle,bookingVehicleMetadata} from '../src/lib/bookingVehicle.js';
import {saveBookingVehicle} from '../src/lib/saveBookingVehicle.js';
import {VEHICLE_MAKES,VEHICLE_MODELS,VEHICLE_COLOURS} from '../src/lib/vehicleOptions.js';
const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
const code=(await transform(app.slice(app.indexOf('function BookingVehicleForm('),app.indexOf('async function persistDriverProfile(')),{loader:'jsx'})).code;
const vehicle={vehicleMake:'Honda',vehicleModel:'Civic',vehicleColour:'Blue',licensePlate:'HOST 123'};
const session=()=>({data:{session:{user:{id:'host',user_metadata:bookingVehicleMetadata(vehicle)},access_token:'host-token'}}});
const later=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function walk(n,out=[]){if(!n||typeof n!=='object')return out;out.push(n);for(const c of React.Children.toArray(n.props?.children))walk(c,out);return out;}
function harness({empty=false,auth=async()=>session(),patch=async()=>({ok:true,json:async()=>({vehicle})})}={}) {
  const slots=[],effects=[],writes=[],requests=[],updates=[],refreshes=[];let cursor=0,dirty=false,tree,props={user:{id:'host',role:'host',...(empty?{}:vehicle)}};
  const values={React,validateBookingVehicle,saveBookingVehicle,VEHICLE_MAKES,VEHICLE_MODELS,VEHICLE_COLOURS,
    supabase:{auth:{getSession:auth,refreshSession:async()=>{refreshes.push(true);return session();}}},
    useState(initial){const n=cursor++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return[slots[n].value,v=>{writes.push(n);const next=typeof v==='function'?v(slots[n].value):v;if(next!==slots[n].value){slots[n].value=next;dirty=true;}}];},
    useRef(initial){const n=cursor++;return slots[n]||(slots[n]={current:initial});},
    useEffect(fn,deps){const n=cursor++,old=slots[n];if(!old||deps.some((v,i)=>v!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();});}},
  };
  // saveBookingVehicle resolves fetch at call time; no real network in UI tests.
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return patch();};
  const c=new Function(...Object.keys(values),code+';return {Form:BookingVehicleForm,Fields:VehicleProfileFields};')(...Object.values(values));
  function render(change={}){props={...props,...change};let count=0;do{dirty=false;cursor=0;tree=c.Form({...props,onSaved:v=>updates.push(v),onCancel:()=>updates.push('cancel')});for(const e of effects.splice(0))e();assert.ok(++count<10);}while(dirty);return tree;}
  const find=predicate=>{const n=walk(render()).find(predicate);assert.ok(n);return n;};
  const fields=()=>find(n=>n.type===c.Fields);
  const save=()=>find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
  const stop=()=>{for(const s of slots)s?.cleanup?.();globalThis.fetch=originalFetch;};
  render();return{render,find,fields,save,stop,c,slots,writes,requests,updates,refreshes,edit:(key,value)=>fields().props.onUpdate(key,value)};
}
test('empty Host form exposes four labeled required fields and refuses incomplete submission',async()=>{
  const h=harness({empty:true});try{
    const markup=h.c.Fields(h.fields().props),controls=walk(markup).filter(n=>n.type==='input'||n.type==='select');
    assert.equal(controls.length,4);assert.ok(controls.every(n=>n.props.required));assert.equal(walk(markup).filter(n=>n.type==='label').length,4);
    await h.save();assert.equal(h.requests.length,0);assert.equal(Object.keys(h.fields().props.errors).length,4);
    for(const [key,value]of Object.entries(vehicle))h.edit(key,value);
    await h.save();assert.equal(h.requests.length,1);assert.deepEqual(h.updates,[vehicle]);
  }finally{h.stop();}
});
test('rapid submits save once; pending work locks fields and cancel before the next render',async()=>{
  const p=later(),h=harness({patch:()=>p.promise});try{
    const submit=h.find(n=>n.type==='form').props.onSubmit;
    const one=submit({preventDefault(){}}),two=submit({preventDefault(){}});await tick();assert.equal(h.requests.length,1);
    h.edit('licensePlate','CHANGED');assert.equal(h.fields().props.vehicle.licensePlate,'HOST 123');assert.equal(h.fields().props.disabled,true);
    h.find(n=>n.type==='button'&&n.props.children==='Cancel').props.onClick();assert.equal(h.updates.length,0);
    p.resolve({ok:true,json:async()=>({vehicle})});await Promise.all([one,two]);assert.deepEqual(h.updates,[vehicle]);
  }finally{h.stop();}
});
test('closed form ignores late save results and cannot refresh another account',async()=>{
  const p=later(),h=harness({patch:()=>p.promise});const work=h.save();await tick();h.stop();const writes=h.writes.length;
  p.resolve({ok:true,json:async()=>({vehicle})});await work;assert.equal(h.writes.length,writes);assert.equal(h.updates.length,0);assert.equal(h.refreshes.length,0);
});
test('A-B-A account changes invalidate an in-flight save',async()=>{
  const p=later(),h=harness({auth:()=>p.promise});try{const work=h.save();h.render({user:{id:'other',role:'host'}});h.render({user:{id:'host',role:'host'}});p.resolve(session());await work;assert.equal(h.requests.length,0);assert.equal(h.updates.length,0);}finally{h.stop();}
});
test('make change clears model; server field errors remain visible and allow an explicit retry',async()=>{
  let n=0;const h=harness({patch:async()=>++n===1?{ok:false,json:async()=>({error:'Check plate',errors:{licensePlate:'Invalid plate'}})}:{ok:true,json:async()=>({vehicle})}});try{
    h.fields().props.onMakeChange('Toyota');assert.equal(h.fields().props.vehicle.vehicleModel,'');
    h.fields().props.onMakeChange('Honda');h.edit('vehicleModel','Civic');await h.save();assert.equal(h.updates.length,0);assert.equal(h.fields().props.errors.licensePlate,'Invalid plate');
    assert.equal(h.find(n=>n.type==='button'&&n.props.type==='submit').props.disabled,false);await h.save();assert.deepEqual(h.updates,[vehicle]);
  }finally{h.stop();}
});
