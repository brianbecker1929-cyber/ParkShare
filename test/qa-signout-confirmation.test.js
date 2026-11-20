import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';

const source = await readFile(process.env.QA_SIGNOUT_APP_SOURCE || new URL('../src/App.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  const handleSignOut = async () => {');
const end = source.indexOf('  // INITIAL_SESSION', start);
assert.ok(start > 0 && end > start);
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const session = id => ({data:{session:id ? {access_token:'synthetic-'+id,user:{id}} : null},error:null});
function harness({signOut, getSession}={}) {
  let user={id:'A'}, stored='A', notice=null, reads=0;
  const calls=[], routes=[], cleared=[];
  const attempt={current:null}, account={current:'A'};
  const auth={getSession:async()=>{reads++;return getSession ? getSession(reads) : session(stored);},signOut:async(...args)=>{calls.push(args);if(signOut)return signOut();stored=null;return {error:null};}};
  const values={supabase:{auth},signOutAttempt:attempt,signOutAccount:account,setSignOutNotice:value=>notice=typeof value==='function'?value(notice):value,
    setUser:value=>{user=value;account.current=value?.id||null;},
    setCheckoutBanner:()=>cleared.push('checkout'),setConnectBanner:()=>cleared.push('connect'),setMessageThread:()=>cleared.push('thread'),setMessageBookingId:()=>cleared.push('booking'),moveToRoute:(...args)=>routes.push(args)};
  const handler=()=>new Function('user',...Object.keys(values),source.slice(start,end)+';return handleSignOut;')(user,...Object.values(values));
  return {run:()=>handler()(),handler,auth,calls,routes,cleared,attempt,account,setStored:value=>stored=value,
    switchTo:id=>{user=id?{id}:null;account.current=id;stored=id;},get notice(){return notice;},get user(){return user;},get reads(){return reads;}};
}

test('returned sign-out failure cannot clear the still-active account or navigate',async()=>{
  const h=harness({signOut:async()=>({error:Error('private provider detail')})});await h.run();
  assert.equal(h.user?.id,'A');assert.deepEqual(h.routes,[]);assert.deepEqual(h.cleared,[]);
  assert.equal(h.notice?.kind,'error');assert.equal(h.notice?.canRetry,true);assert.doesNotMatch(h.notice.message,/private provider detail/);
});
test('thrown sign-out failures are caught and offer retry',async()=>{
  const h=harness({signOut:async()=>{throw Error('network secret');}});
  await assert.doesNotReject(h.run());assert.equal(h.user?.id,'A');assert.equal(h.notice?.canRetry,true);assert.deepEqual(h.routes,[]);
});
test('normal sign-out retains existing SDK scope, verifies removal and clears private navigation',async()=>{
  const h=harness();await h.run();assert.deepEqual(h.calls,[[]]);assert.equal(h.reads,2);assert.equal(h.user,null);
  assert.deepEqual(h.routes,[['app','Browse']]);assert.equal(h.cleared.length,4);assert.equal(h.notice,null);
});
test('a success response with a retained session is not presented as signed out',async()=>{
  const h=harness({signOut:async()=>({error:null})});await h.run();assert.equal(h.user.id,'A');assert.equal(h.notice.canRetry,true);assert.deepEqual(h.routes,[]);
});
test('unreadable and malformed session responses never invoke sign-out or clear the account',async()=>{
  for(const value of [undefined,{}, {data:{}}, {data:{session:null},error:Error('unavailable')}]){
    const h=harness({getSession:async()=>value});await h.run();assert.equal(h.user.id,'A');assert.equal(h.calls.length,0);assert.equal(h.notice.kind,'error');assert.deepEqual(h.routes,[]);
  }
});
test('a known foreign account is never submitted to SDK sign-out',async()=>{
  const h=harness({getSession:async()=>session('B')});await h.run();assert.equal(h.calls.length,0);assert.equal(h.user.id,'A');assert.deepEqual(h.routes,[]);assert.equal(h.notice.canRetry,false);
});
test('already signed-out sessions finish without another provider call',async()=>{
  const h=harness({getSession:async()=>session(null)});await h.run();assert.equal(h.calls.length,0);assert.equal(h.user,null);assert.deepEqual(h.routes,[['app','Browse']]);
});
test('duplicate and queued submits share one pending attempt; retry is available afterward',async()=>{
  const d=deferred(),h=harness({signOut:()=>d.promise});const stale=h.handler(),work=stale();await Promise.resolve();await Promise.resolve();
  assert.equal(h.notice.kind,'pending');await stale();assert.equal(h.calls.length,1);d.resolve({error:Error('failed')});await work;
  assert.equal(h.attempt.current,null);await h.run();assert.equal(h.calls.length,2);assert.equal(h.user.id,'A');
});
test('account changes while preflight is pending prevent provider calls and obsolete feedback',async()=>{
  const d=deferred(),h=harness({getSession:()=>d.promise});const work=h.run();h.switchTo('B');d.resolve(session('A'));await work;
  assert.equal(h.calls.length,0);assert.equal(h.user.id,'B');assert.deepEqual(h.routes,[]);assert.notEqual(h.notice?.kind,'error');
});
test('late success, returned error and exception cannot clear a replacement account or its route',async()=>{
  for(const outcome of ['success','error','throw']){const d=deferred(),h=harness({signOut:()=>d.promise});const work=h.run();await Promise.resolve();await Promise.resolve();h.switchTo('B');
    if(outcome==='throw')d.reject(Error('old failure'));else d.resolve({error:outcome==='error'?Error('old failure'):null});
    await work;assert.equal(h.user.id,'B');assert.deepEqual(h.routes,[]);assert.deepEqual(h.cleared,[]);assert.notEqual(h.notice?.kind,'error');}
});
test('a stored account change before its React notification also suppresses stale completion',async()=>{
  const d=deferred(),h=harness({signOut:()=>d.promise});const work=h.run();await Promise.resolve();await Promise.resolve();h.setStored('B');d.resolve({error:null});await work;
  assert.equal(h.user.id,'A');assert.deepEqual(h.routes,[]);assert.equal(h.notice.canRetry,false);
});
test('local removal with a provider error distinguishes unconfirmed sign-out on other devices',async()=>{
  let h;h=harness({signOut:async()=>{h.switchTo(null);return {error:Error('server failure')};}});await h.run();
  assert.equal(h.user,null);assert.match(h.notice.message,/other devices/);assert.equal(h.notice.showSignedOut,true);assert.equal(h.notice.canRetry,false);assert.deepEqual(h.routes,[]);
});
test('unmounted or retired attempts cannot clear UI or publish delayed failures',async()=>{
  const d=deferred(),h=harness({signOut:()=>d.promise});const work=h.run();await Promise.resolve();await Promise.resolve();h.attempt.current.active=false;h.attempt.current=null;d.resolve({error:Error('late')});await work;
  assert.equal(h.user.id,'A');assert.deepEqual(h.routes,[]);assert.notEqual(h.notice?.kind,'error');
});

// Run the App's real sign-out state/effects, handler and notice JSX together.
const stateStart=source.indexOf('  const [signOutNotice, setSignOutNotice]');
const stateEnd=source.indexOf('  const messageScope =',stateStart);
const noticeStart=source.indexOf('      {/* Sign-out feedback */}');
const noticeEnd=source.indexOf('      {/* End sign-out feedback */}',noticeStart);
const rootCode=stateStart<0 ? null : (await transform('function Root(){const [user,setUser]=useState({id:"A"});'+source.slice(stateStart,stateEnd)+source.slice(start,end)+';return {user,setUser,handleSignOut,notice:signOutNotice,tree:<> '+source.slice(noticeStart,noticeEnd)+' </>};}',{loader:'jsx'})).code;
const walk=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(walk):[n,...walk(n.props?.children)];
function rootHarness(signOut){
  let index=0,result,stored='A',dirty=false,stopped=false,writesAfterStop=0;
  const slots=[],effects=[],calls=[],routes=[];
  const hooks={useState:initial=>{const i=index++;if(!(i in slots))slots[i]={value:initial};return[slots[i].value,value=>{if(stopped)writesAfterStop++;const next=typeof value==='function'?value(slots[i].value):value;if(next!==slots[i].value){slots[i].value=next;dirty=true;}}];},
    useRef:initial=>{const i=index++;return slots[i]||(slots[i]={current:initial});},useEffect:(fn,deps)=>{const i=index++,old=slots[i];if(!old||deps.some((x,n)=>x!==old.deps[n])){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
  const values={React,...hooks,C:{navy:'#0E1B2E',amber:'#FFC107',white:'#fff'},supabase:{auth:{getSession:async()=>session(stored),signOut:async()=>{calls.push('signOut');if(signOut)return signOut();stored=null;return {error:null};}}},setCheckoutBanner:()=>{},setConnectBanner:()=>{},setMessageThread:()=>{},setMessageBookingId:()=>{},moveToRoute:(...args)=>routes.push(args)};
  const Root=new Function(...Object.keys(values),rootCode+';return Root;')(...Object.values(values));
  const render=()=>{let count=0;do{dirty=false;index=0;result=Root();effects.splice(0).forEach(fn=>fn());assert.ok(++count<10);}while(dirty);return result;};
  const button=label=>{const node=walk(render().tree).find(n=>n.type==='button'&&n.props.children===label);assert.ok(node,label);return node;};
  render();return {render,button,calls,routes,run:()=>render().handleSignOut(),switchTo:id=>{stored=id;result.setUser(id?{id}:null);render();},stop:()=>{stopped=true;slots.forEach(slot=>slot?.cleanup?.());},get html(){return renderToStaticMarkup(render().tree).trim();},get writesAfterStop(){return writesAfterStop;}};
}
test('App error notice announces failure, dismisses and retries the real sign-out handler',async()=>{
  let fail=true,h;h=rootHarness(async()=>{if(fail)return{error:Error('failure')};h.switchTo(null);return {error:null};});
  await h.run();assert.match(h.html,/role="alert"/);assert.match(h.html,/aria-live="assertive"/);assert.match(h.html,/We couldn&#x27;t sign you out/);
  assert.equal(h.button('Retry sign out').props.style.minHeight,44);h.button('Dismiss').props.onClick();assert.equal(h.html,'');
  await h.run();fail=false;await h.button('Retry sign out').props.onClick();assert.equal(h.render().user,null);assert.equal(h.html,'');assert.deepEqual(h.routes,[['app','Browse']]);h.stop();
});
test('App displays a pending status and blocks duplicate clicks until completion',async()=>{
  const d=deferred(),h=rootHarness(()=>d.promise);const work=h.run();await Promise.resolve();await Promise.resolve();assert.match(h.html,/role="status"/);assert.match(h.html,/Signing out/);
  await h.run();assert.equal(h.calls.length,1);d.resolve({error:Error('failure')});await work;assert.match(h.html,/Retry sign out/);h.stop();
});
test('App account effects retire A→B→A attempts and hide old account feedback',async()=>{
  const d=deferred(),h=rootHarness(()=>d.promise);const work=h.run();await Promise.resolve();await Promise.resolve();h.switchTo('B');assert.equal(h.html,'');h.switchTo('A');d.resolve({error:Error('old failure')});await work;
  assert.equal(h.render().user.id,'A');assert.equal(h.html,'');assert.deepEqual(h.routes,[]);h.stop();
});
test('a completed error is discarded on an account switch and does not reappear on return',async()=>{
  const h=rootHarness(async()=>({error:Error('failure')}));await h.run();assert.match(h.html,/Retry sign out/);
  h.switchTo('B');assert.equal(h.html,'');h.switchTo('A');assert.equal(h.html,'');h.stop();
});
test('App unmount cleanup prevents state writes from delayed SDK results',async()=>{
  const d=deferred(),h=rootHarness(()=>d.promise);const work=h.run();await Promise.resolve();await Promise.resolve();h.stop();d.resolve({error:Error('late')});await work;assert.equal(h.writesAfterStop,0);assert.deepEqual(h.routes,[]);
});
test('signed-out revocation warning remains visible without offering an invalid retry',async()=>{
  let h;h=rootHarness(async()=>{h.switchTo(null);return{error:Error('unavailable')};});await h.run();assert.match(h.html,/other devices/);assert.doesNotMatch(h.html,/Retry sign out/);h.button('Dismiss').props.onClick();assert.equal(h.html,'');h.stop();
});
