import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeBookingStatus} from '../src/lib/bookingReadiness.js';
const source=(await readFile(new URL('../src/lib/useListingBookability.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export function useListingBookability','return function useListingBookability');
function harness(id=7){
 const slots=[],pending=[],listeners={focus:new Set(),visibilitychange:new Set()};let cursor=0,dirty=false,result,paused=false,stopped=false;
 const effects=[],document={visibilityState:'visible',addEventListener:(k,f)=>listeners[k].add(f),removeEventListener:(k,f)=>listeners[k].delete(f)};
 const useState=initial=>{const n=cursor++;if(!slots[n])slots[n]={value:initial};return [slots[n].value,value=>{slots[n].value=typeof value==='function'?value(slots[n].value):value;dirty=true;}];};
 const useRef=initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});};
 const useEffect=(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((v,i)=>v!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();});}};
 const fetch=(url,init)=>new Promise((resolve,reject)=>pending.push({url,init,resolve,reject}));
 const hook=new Function('useState','useRef','useEffect','normalizeBookingStatus','window','document','fetch','AbortController',source)(useState,useRef,useEffect,normalizeBookingStatus,{addEventListener:(k,f)=>listeners[k].add(f),removeEventListener:(k,f)=>listeners[k].delete(f)},document,fetch,AbortController);
 function render(next=id,pause=paused){id=next;paused=pause;let count=0;do{dirty=false;cursor=0;result=hook(id,paused);for(const fn of effects.splice(0))fn();assert.ok(++count<12);}while(dirty);return result;}
 render();
 return {pending,document,listeners,render,get result(){return result;},event:key=>{for(const fn of [...listeners[key]])fn();render();},async reply(index,status='ready',ok=true){pending[index].resolve({ok,json:async()=>({bookingStatus:status})});await new Promise(r=>setImmediate(r));if(!stopped)render();},async fail(index){pending[index].reject(Error('offline'));await new Promise(r=>setImmediate(r));render();},stop(){stopped=true;for(const slot of slots)slot?.cleanup?.();}};
}
test('BUG-005490 detail starts checking, accepts only verified HTTP replies, and retries failures',async()=>{
 for(const kind of ['network','http','malformed']){const h=harness();try{assert.equal(h.result.status,'checking');assert.equal(h.pending[0].url,'/api/listing-bookability?listingId=7');assert.equal(h.pending[0].init.cache,'no-store');if(kind==='network')await h.fail(0);else await h.reply(0,kind==='malformed'?'junk':'ready',kind!=='http');assert.equal(h.result.status,'unknown');const retry=h.result.retry;retry();retry();h.render();assert.equal(h.pending.length,2);assert.equal(h.result.status,'checking');await h.reply(1,'not_ready');assert.equal(h.result.status,'not_ready');h.result.retry();h.render();await h.reply(2);assert.equal(h.result.status,'ready');}finally{h.stop();}}
});
test('listing A-B-A changes and retired retry callbacks cannot reuse or publish stale readiness',async()=>{
 const h=harness();try{const oldRetry=h.result.retry;h.render(8);assert.equal(h.pending[0].init.signal.aborted,true);h.render(7);assert.equal(h.pending.length,3);await h.reply(0);await h.reply(1);assert.equal(h.result.status,'checking');oldRetry();h.render();assert.equal(h.pending.length,3);await h.reply(2,'not_ready');assert.equal(h.result.status,'not_ready');}finally{h.stop();}
});
test('focus rechecks, superseded responses fail closed, and payment pause avoids disruptive refreshes',async()=>{
 const h=harness();try{await h.reply(0);h.event('focus');assert.equal(h.result.status,'checking');h.event('visibilitychange');assert.equal(h.pending[1].init.signal.aborted,true);await h.reply(1);assert.equal(h.result.status,'checking');await h.reply(2);h.render(7,true);h.event('focus');assert.equal(h.pending.length,3);assert.equal(h.result.status,'ready');h.render(8,true);assert.equal(h.result.status,'checking');assert.equal(h.pending.length,4,'A different listing always starts its own check');}finally{h.stop();}assert.equal(h.listeners.focus.size,0);assert.equal(h.listeners.visibilitychange.size,0);
});
test('hidden tabs do not refresh and unmount aborts work; demo listings do not call providers',async()=>{
 const h=harness();h.document.visibilityState='hidden';h.event('focus');assert.equal(h.pending.length,1);h.stop();assert.equal(h.pending[0].init.signal.aborted,true);await h.reply(0);for(const id of [null,0,-1,'db-7']){const demo=harness(id);assert.equal(demo.result.status,'ready');assert.equal(demo.pending.length,0);demo.stop();}
});
