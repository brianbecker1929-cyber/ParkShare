import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {validId} from '../src/lib/privateListingAccess.js';
const source=await readFile(process.env.QA_REVIEW_SOURCE||new URL('../src/App.jsx',import.meta.url),'utf8');
const start=source.includes('function useReviewSubmission(')?source.indexOf('function useReviewSubmission('):source.indexOf('function ReviewsSection(');
const shared=source.slice(start,source.indexOf('// ─── Listing Detail',start));
const modalStart=source.indexOf('function ReviewModal(');
const compiled=await transform(shared+source.slice(modalStart,source.indexOf('// ─── Driver Profile',modalStart)),{loader:'jsx'});
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const session=id=>({data:{session:id?{user:{id},access_token:id+'-token'}:null}});
const reply=(listing=7,rating=5)=>({ok:true,json:async()=>({review:{id:51,listing_id:listing,rating}})});
function elements(node,predicate,out=[]){if(!node||typeof node!=='object')return out;if(predicate(node))out.push(node);for(const child of React.Children.toArray(node.props?.children))elements(child,predicate,out);return out;}
const label=node=>React.Children.toArray(node.props.children).filter(x=>typeof x==='string').join('');
function harness(kind='modal',{auth=async()=>session('A'),post=async()=>reply(),publicRead=async()=>({ok:true,json:async()=>({reviews:[]})})}={}){
 const slots=[],pendingEffects=[],effectSetups=[],writes=[],requests=[],publicRequests=[];let cursor=0,dirty=false,tree,closed=0,submitted=0;
 let props={user:{id:'A'},listing:{id:'db-7',title:'Seven',rating:5},booking:{id:'db-1',listing:{id:'db-7',title:'Seven'}}};
 const Modal=()=>null,Btn=()=>null;
 const values={React,C:{},Modal,Btn,Stars:()=>null,REVIEWS_DATA:{demo:[]},validId,supabase:{auth:{getSession:auth}},fetch:(url,options)=>{
  if(url.startsWith('/api/public-reviews')){publicRequests.push({url,options});return publicRead(url,options);}
  requests.push({url,options,body:JSON.parse(options.body)});return post(url,options);
 },console:{error:()=>{}},useState:initial=>{const n=cursor++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{writes.push(n);const value=typeof v==='function'?v(slots[n].value):v;if(value!==slots[n].value){slots[n].value=value;dirty=true;}}];},useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},useEffect:(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((x,i)=>x!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};pendingEffects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();effectSetups[n]=fn;});}}};
 const Components=new Function(...Object.keys(values),compiled.code+';return {modal:ReviewModal,section:ReviewsSection};')(...Object.values(values));
 function render(changes={}){props={...props,...changes};let count=0;do{dirty=false;cursor=0;tree=Components[kind]({...props,onClose:()=>closed++,onSubmit:()=>submitted++,onSubmitReview:()=>submitted++});assert.ok(++count<8);}while(dirty);for(const effect of pendingEffects.splice(0))effect();return tree;}
 const button=text=>{const found=elements(render(),n=>(n.type===Btn||n.type==='button')&&label(n).includes(text))[0];assert.ok(found,`missing ${text}`);return found.props.onClick;};
 const open=()=>{if(kind==='section')button('Write a review')();};
 const text=value=>{const area=elements(render(),n=>n.type==='textarea')[0];assert.ok(area);area.props.onChange({target:{value}});};
 const submit=()=>button('Submit review')();
 const cancel=()=>kind==='modal'?elements(render(),n=>n.type===Modal)[0].props.onClose():button('Cancel')();
 const stop=()=>{for(const slot of slots)slot?.cleanup?.();};
 render();open();text('A good driveway');
 const replay=()=>{for(const [n,fn] of effectSetups.entries())if(fn){slots[n].cleanup?.();slots[n].cleanup=fn();}render();};
 return {render,text,submit,cancel,stop,replay,button,requests,publicRequests,writes,get tree(){return tree;},get submitted(){return submitted;},get closed(){return closed;},hasError:()=>elements(render(),n=>n.props?.role==='alert').length>0};
}
for(const kind of ['modal','section']){
 test(`${kind}: real reviews cannot report success after sign-out`,async()=>{
  const h=harness(kind);h.render({user:null});if(kind==='section')h.button('Write a review')();h.text('Signed out review');await h.submit();assert.equal(h.submitted,0);assert.equal(h.requests.length,0);assert.equal(h.closed,0);assert.ok(h.hasError());h.stop();
 });
 test(`${kind}: another session owner cannot submit the original draft`,async()=>{
  const h=harness(kind,{auth:async()=>session('B')});await h.submit();assert.equal(h.requests.length,0);assert.equal(h.submitted,0);assert.ok(h.hasError());h.stop();
 });
 test(`${kind}: rapid submits make one pending POST before any render`,async()=>{
  const pending=later(),h=harness(kind,{post:()=>pending.promise});const submit=h.button('Submit review'),a=submit(),b=submit();await tick();assert.equal(h.requests.length,1);pending.resolve(reply());await Promise.all([a,b]);assert.equal(h.submitted,1);assert.equal(h.requests[0].options.headers.Authorization,'Bearer A-token');assert.deepEqual(h.requests[0].body,{listingId:7,rating:5,text:'A good driveway'});h.stop();
 });
 test(`${kind}: auth and transport failures show an error and unlock explicit retry`,async()=>{
  for(const where of ['auth','post','http','json']){let calls=0;const h=harness(kind,{auth:async()=>{if(where==='auth'&&calls++===0)throw Error('Synthetic auth failure');return session('A');},post:async()=>{if(where==='auth')return reply();if(calls++===0){if(where==='post')throw Error('Synthetic network failure');if(where==='http')return {ok:false,json:async()=>({error:'Already reviewed'})};return {ok:true,json:async()=>{throw Error('Invalid JSON');}};}return reply();}});await assert.doesNotReject(h.submit());assert.equal(h.submitted,0);assert.ok(h.hasError());assert.equal(h.button('Submit review') instanceof Function,true);await h.submit();assert.equal(h.submitted,1);h.stop();}
 });
 test(`${kind}: closing during authentication prevents a POST and queued old submits`,async()=>{
  const pending=later(),h=harness(kind,{auth:()=>pending.promise}),old=h.button('Submit review'),work=old();h.cancel();await tick();const count=h.writes.length;pending.resolve(session('A'));await work;await old();assert.equal(h.requests.length,0);assert.equal(h.submitted,0);assert.equal(h.writes.length,count);h.stop();
 });
 test(`${kind}: account A-B-A cannot revive an old lookup or draft`,async()=>{
  const pending=later(),h=harness(kind,{auth:()=>pending.promise}),work=h.submit();h.render({user:{id:'B'}});h.render({user:{id:'A'}});await tick();const count=h.writes.length;pending.resolve(session('A'));await work;assert.equal(h.requests.length,0);assert.equal(h.submitted,0);assert.equal(h.writes.length,count);assert.doesNotMatch(JSON.stringify(h.render()),/A good driveway/);h.stop();
 });
 test(`${kind}: obsolete response and error cannot update dismissed or unmounted forms`,async()=>{
  for(const how of ['cancel','unmount'])for(const fail of [false,true]){const pending=later(),h=harness(kind,{post:()=>pending.promise}),work=h.submit();await tick();if(how==='cancel')h.cancel();else h.stop();await tick();const count=h.writes.length;if(fail)pending.reject(Error('OLD ERROR'));else pending.resolve(reply());await assert.doesNotReject(work);assert.equal(h.submitted,0);assert.equal(h.writes.length,count);h.stop();}
 });
 test(`${kind}: malformed success never marks a review saved`,async()=>{
  for(const value of [{},{review:{id:1,listing_id:8,rating:5}},{review:{id:1,listing_id:7,rating:4}}]){const h=harness(kind,{post:async()=>({ok:true,json:async()=>value})});await h.submit();assert.equal(h.submitted,0);assert.ok(h.hasError());h.stop();}
 });
 test(`${kind}: changing the target clears the draft and blocks the old result`,async()=>{
  const pending=later(),h=harness(kind,{post:()=>pending.promise}),work=h.submit();await tick();h.render({listing:{id:'db-8',title:'Eight',rating:5},booking:{id:'db-2',listing:{id:'db-8',title:'Eight'}}});await tick();const count=h.writes.length;pending.resolve(reply());await work;assert.equal(h.submitted,0);assert.equal(h.writes.length,count);assert.doesNotMatch(JSON.stringify(h.render()),/A good driveway/);h.stop();
 });
}
test('section: public review response for an old listing cannot overwrite the new listing',async()=>{
 const first=later(),second=later();let count=0;const h=harness('section',{publicRead:()=>++count===1?first.promise:second.promise});h.render({listing:{id:'db-8',title:'Eight',rating:5}});second.resolve({ok:true,json:async()=>({reviews:[{user:'Eight reviewer',text:'Eight review',rating:4}]})});await tick();first.resolve({ok:true,json:async()=>({reviews:[{user:'Seven reviewer',text:'Seven review',rating:1}]})});await tick();const text=JSON.stringify(h.render());assert.match(text,/Eight review/);assert.doesNotMatch(text,/Seven review/);assert.equal(h.publicRequests[0].options.signal.aborted,true);h.stop();
});
test('section: successful POST refreshes public reviews and reports success only once',async()=>{
 const h=harness('section');await h.submit();h.render();await tick();assert.equal(h.submitted,1);assert.equal(h.publicRequests.length,2);assert.match(JSON.stringify(h.render()),/Thanks for your review/);h.stop();
});
test('section: initial review loading never claims that a listing has no reviews',async()=>{
 const pending=later(),h=harness('section',{publicRead:()=>pending.promise});const text=JSON.stringify(h.render());
 assert.match(text,/Loading reviews/);assert.doesNotMatch(text,/No reviews yet/);h.stop();pending.resolve({ok:true,json:async()=>({reviews:[]})});await tick();
});
test('section: failed review reads show an error and retry rather than an empty history',async()=>{
 const h=harness('section',{publicRead:async()=>({ok:false,json:async()=>({error:'private provider details'})})});await tick();const text=JSON.stringify(h.render());
 assert.match(text,/Reviews are temporarily unavailable/);assert.doesNotMatch(text,/No reviews yet|private provider details/);assert.ok(h.hasError());assert.ok(h.button('Retry reviews'));h.stop();
});
test('section: only a successful empty array may display the genuine empty state',async()=>{
 const h=harness('section');assert.doesNotMatch(JSON.stringify(h.render()),/No reviews yet/);await tick();
 assert.match(JSON.stringify(h.render()),/No reviews yet/);assert.doesNotMatch(JSON.stringify(h.render()),/Loading reviews|temporarily unavailable/);h.stop();
});
test('section: transport, JSON and malformed summaries fail closed without false empty counts',async()=>{
 for(const value of [null,{}, {reviews:null},{reviews:{}},{reviews:[null]},{reviews:[{rating:0}]},{reviews:[{rating:'5'}]},{reviews:[{rating:5,user:{id:'private'}}]}]){
  const h=harness('section',{publicRead:async()=>({ok:true,json:async()=>value})});await tick();const text=JSON.stringify(h.render());assert.match(text,/Reviews are temporarily unavailable/);assert.doesNotMatch(text,/No reviews yet|private/);h.stop();
 }
 for(const where of ['transport','json']){const h=harness('section',{publicRead:async()=>{if(where==='transport')throw Error('private transport failure');return{ok:true,json:async()=>{throw Error('private malformed JSON');}};}});await tick();assert.match(JSON.stringify(h.render()),/Reviews are temporarily unavailable/);assert.doesNotMatch(JSON.stringify(h.render()),/No reviews yet|private transport|private malformed/);h.stop();}
});
test('section: explicit retry makes one current GET and replaces the error with loaded summaries',async()=>{
 let count=0;const pending=later(),h=harness('section',{publicRead:async()=>++count===1?{ok:false}:pending.promise});await tick();const retry=h.button('Retry reviews');retry();retry();h.render();
 assert.equal(h.publicRequests.length,2);assert.match(JSON.stringify(h.render()),/Loading reviews/);assert.doesNotMatch(JSON.stringify(h.render()),/No reviews yet|temporarily unavailable/);
 pending.resolve({ok:true,json:async()=>({reviews:[{user:'ParkShare driver',rating:4,date:'Oct 2026',text:''}]})});await tick();assert.match(JSON.stringify(h.render()),/ParkShare driver/);assert.doesNotMatch(JSON.stringify(h.render()),/Loading reviews|temporarily unavailable|No reviews yet/);
 retry();h.render();assert.equal(h.publicRequests.length,2);assert.equal(h.requests.length,0);assert.equal(h.publicRequests[0].options.signal.aborted,true);assert.equal(h.publicRequests[1].options.cache,'no-store');h.stop();
});
test('section: retry failures remain retryable without sending any review POST',async()=>{
 const h=harness('section',{publicRead:async()=>({ok:false})});await tick();for(let n=2;n<=3;n++){h.button('Retry reviews')();h.render();await tick();assert.ok(h.hasError());assert.equal(h.publicRequests.length,n);}assert.equal(h.requests.length,0);h.stop();
});
test('section: listing changes discard old errors and cached retry callbacks even on A→B→A',async()=>{
 const h=harness('section',{publicRead:async()=>({ok:false})});await tick();const oldRetry=h.button('Retry reviews');
 h.render({listing:{id:'db-8',title:'Eight',rating:5}});assert.match(JSON.stringify(h.render()),/Loading reviews/);oldRetry();h.render();assert.equal(h.publicRequests.length,2);await tick();
 h.render({listing:{id:'db-7',title:'Seven',rating:5}});await tick();oldRetry();h.render();assert.equal(h.publicRequests.length,3);h.stop();
});
test('section: delayed public failures and unmounted requests cannot write state or restore old errors',async()=>{
 for(const mode of ['listing','unmount']){const old=later();let count=0;const h=harness('section',{publicRead:()=>++count===1?old.promise:Promise.resolve({ok:true,json:async()=>({reviews:[]})})});
  if(mode==='listing'){h.render({listing:{id:'db-8',title:'Eight',rating:5}});await tick();}else h.stop();
  const writes=h.writes.length;old.reject(Error('old private failure'));await tick();assert.equal(h.writes.length,writes);if(mode==='listing')assert.match(JSON.stringify(h.render()),/No reviews yet/);assert.equal(h.publicRequests[0].options.signal.aborted,true);h.stop();
 }
});
test('section: successful submission refresh shows loading until the new summary arrives',async()=>{
 const pending=later();let count=0;const h=harness('section',{publicRead:()=>++count===1?Promise.resolve({ok:true,json:async()=>({reviews:[]})}):pending.promise});await tick();await h.submit();
 assert.match(JSON.stringify(h.render()),/Loading reviews/);assert.doesNotMatch(JSON.stringify(h.render()),/No reviews yet/);assert.equal(h.requests.length,1);assert.equal(h.publicRequests.length,2);
 pending.resolve({ok:true,json:async()=>({reviews:[{rating:5,user:'ParkShare driver',text:''}]})});await tick();assert.match(JSON.stringify(h.render()),/Thanks for your review/);assert.doesNotMatch(JSON.stringify(h.render()),/Loading reviews|No reviews yet/);h.stop();
});
test('section: explicit demo reviews remain local and do not use the real API',async()=>{
 const h=harness('section');h.render({listing:{id:'demo',title:'Demo',rating:5},user:null});h.button('Write a review')();h.text('Demo experience');await h.submit();assert.equal(h.requests.length,0);assert.equal(h.submitted,1);assert.match(JSON.stringify(h.render()),/Demo experience/);h.stop();
});
test('booking review modal is keyed by the current account and selected booking',async()=>{
 const tag=source.match(/<ReviewModal\b[\s\S]*?\/>/)[0],code=await transform('function Parent(){return '+tag+';}',{loader:'jsx'});const values={React,ReviewModal:()=>null,user:{id:'A'},reviewTarget:{id:'db-1'},setReviewTarget:()=>{},setReviewed:()=>{}};const element=new Function(...Object.keys(values),code.code+';return Parent();')(...Object.values(values));assert.equal(element.key,'A:db-1');
});

test('StrictMode effect cleanup/setup keeps the current form usable without reviving disposed callbacks',async()=>{
 for(const kind of ['modal','section']){const h=harness(kind),old=h.button('Submit review');h.replay();await old();assert.equal(h.requests.length,0);await h.submit();assert.equal(h.submitted,1);assert.equal(h.requests.length,1);h.stop();}
});
