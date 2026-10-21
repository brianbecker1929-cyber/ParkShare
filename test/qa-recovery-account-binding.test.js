import assert from 'node:assert/strict';
import test from 'node:test';
import {updateRecoveryPasswordForAccount as update} from '../src/lib/passwordRecovery.js';

const password='Synthetic password only';
const session=(id='A',token='token-'+id)=>({data:{session:{access_token:token,user:{id}}},error:null});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture({sessions,verify=async()=>({data:{user:{id:'A'}},error:null}),send=async()=>Response.json({id:'A'}),expected='A'}={}){
  const calls=[],writes=[],tokens=[];let reads=0,active=true;
  const client={auth:{getSession:async()=>{const n=reads++;return sessions?await sessions(n):session();},getUser:async token=>{tokens.push(token);return verify(token);},
    updateUser:()=>assert.fail('Recovery cannot reread the shared SDK session for its write'),setSession:()=>assert.fail('Recovery cannot replace the shared session'),refreshSession:()=>assert.fail('Recovery cannot restore an old account')}};
  const request=async(url,options)=>{calls.push({url,options});writes.push({token:options.headers.Authorization,password:JSON.parse(options.body).password});return send(url,options);};
  return {calls,writes,tokens,run:(overrides={})=>update({client,authUrl:'https://fixture.invalid',publishableKey:'synthetic-public-key',expectedAccountId:expected,password,isCurrent:()=>active,request,...overrides}),stop:()=>{active=false;},get reads(){return reads;}};
}

test('password write uses only the server-verified captured bearer and never shared-session mutation',async()=>{
  const h=fixture(),result=await h.run();assert.equal(result.data.user.id,'A');assert.equal(h.reads,3);assert.deepEqual(h.tokens,['token-A']);
  assert.equal(h.calls.length,1);const {url,options}=h.calls[0];assert.equal(url,'https://fixture.invalid/auth/v1/user');assert.equal(options.method,'PUT');
  assert.deepEqual(options.headers,{'Content-Type':'application/json',apikey:'synthetic-public-key',Authorization:'Bearer token-A'});
  assert.deepEqual(h.writes,[{token:'Bearer token-A',password}]);assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
});
test('a different current account, sign-out or missing recovery owner cannot start a write',async()=>{
  for(const value of [session('B'),{data:{session:null}},null,{error:Error('expired')},{data:{session:{user:{id:'A'},access_token:{invalid:true}}}}]){
    const h=fixture({sessions:async()=>value});await assert.rejects(h.run(),e=>e.code==='recovery_session_changed');assert.equal(h.calls.length,0);
  }
  for(const expected of [null,'','  ']){const h=fixture({expected});await assert.rejects(h.run(),e=>e.code==='recovery_session_changed');assert.equal(h.reads,0);}
});
test('forged cached user identity cannot authorize a bearer belonging to another account',async()=>{
  const h=fixture({sessions:async()=>session('A','token-B'),verify:async()=>({data:{user:{id:'B'}}})});
  await assert.rejects(h.run(),e=>e.code==='recovery_session_changed');assert.deepEqual(h.tokens,['token-B']);assert.equal(h.calls.length,0);
});
test('an account switch during server verification blocks the password write before its request',async()=>{
  let account='A';const h=fixture({sessions:async()=>session(account),verify:async()=>{account='B';return {data:{user:{id:'A'}}};}});
  await assert.rejects(h.run(),e=>e.code==='recovery_session_changed');assert.equal(h.calls.length,0);assert.equal(account,'B');
});
test('a switch immediately after preflight can only write the original verified token, never the new account',async()=>{
  let shared='A';const h=fixture({sessions:async n=>{if(n===1){shared='B';return session('A');}return session(shared);},send:async(_url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer token-A');assert.equal(shared,'B');return Response.json({id:'A'});
  }});
  await assert.rejects(h.run(),e=>e.code==='recovery_session_changed');assert.equal(h.calls.length,1);assert.equal(shared,'B');assert.equal(h.writes[0].token,'Bearer token-A');
});
test('same-account token rotation keeps the verified original bearer and permits one successful update',async()=>{
  const h=fixture({sessions:async n=>session('A',n===0?'token-A':'rotated-A')});assert.equal((await h.run()).data.user.id,'A');assert.equal(h.calls[0].options.headers.Authorization,'Bearer token-A');
});
test('retiring a form during either session lookup or token verification prevents its write',async()=>{
  for(const phase of ['session','verify']){
    const pending=deferred(),h=fixture({sessions:phase==='session'?()=>pending.promise:undefined,verify:phase==='verify'?()=>pending.promise:undefined});
    const work=h.run();await new Promise(r=>setImmediate(r));h.stop();pending.resolve(phase==='session'?session():{data:{user:{id:'A'}}});
    assert.equal(await work,null);assert.equal(h.calls.length,0);
  }
});
test('an in-flight request cannot publish success or inspect a replacement session after disposal',async()=>{
  const pending=deferred(),h=fixture({send:()=>pending.promise}),work=h.run();await new Promise(r=>setImmediate(r));h.stop();
  pending.resolve(Response.json({id:'A'}));assert.equal(await work,null);assert.equal(h.calls.length,1);assert.equal(h.reads,2);
});
test('foreign, empty or malformed successful replies cannot claim a completed password update',async()=>{
  for(const value of [{id:'B'},{},null,{user:{id:'A'}}]){
    const h=fixture({send:async()=>Response.json(value)});await assert.rejects(h.run(),/couldn't confirm your password update/);assert.equal(h.calls.length,1);
  }
  const h=fixture({send:async()=>new Response('invalid-json')});await assert.rejects(h.run(),/couldn't confirm/);
});
test('expired/revoked token failures invalidate recovery without retry or adopting another session',async()=>{
  for(const status of [401,403]){const h=fixture({send:async()=>Response.json({msg:'expired'},{status})});await assert.rejects(h.run(),e=>e.code==='recovery_session_changed');assert.equal(h.calls.length,1);assert.equal(h.reads,2);}
});
test('policy errors allow explicit correction; transport failure explains uncertainty without echoing secrets',async()=>{
  const denied=fixture({send:async()=>Response.json({msg:'Synthetic password policy rejection'},{status:422})});await assert.rejects(denied.run(),/Synthetic password policy rejection/);
  const h=fixture({send:async()=>{throw Error('private token-A '+password);}});await assert.rejects(h.run(),e=>e.message.includes('Try signing in')&&!e.message.includes(password)&&!e.message.includes('token-A'));assert.equal(h.calls.length,1);
});
test('missing or rejected token verification and session lookups fail closed without password requests',async()=>{
  for(const verify of [async()=>({error:Error('expired')}),async()=>null,async()=>{throw Error('offline');}]){const h=fixture({verify});await assert.rejects(h.run(),e=>e.code==='recovery_session_changed');assert.equal(h.calls.length,0);}
  const h=fixture({sessions:async()=>{throw Error('offline');}});await assert.rejects(h.run(),e=>e.code==='recovery_session_changed');assert.equal(h.calls.length,0);
});
test('inactive, invalid-password or invalid-config attempts never make a password request',async()=>{
  const h=fixture();h.stop();assert.equal(await h.run(),null);assert.equal(h.reads,0);
  for(const value of ['',null,'short']){const x=fixture();await assert.rejects(x.run({password:value}),/at least 12/);assert.equal(x.reads,0);}
  for(const config of [{authUrl:'http://fixture.invalid'},{publishableKey:''}]){const x=fixture();await assert.rejects(x.run(config),/temporarily unavailable/);assert.equal(x.calls.length,0);}
});
