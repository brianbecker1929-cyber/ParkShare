import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {normaliseDriverProfile,getDriverProfileCompletion} from '../src/lib/driverProfile.js';

const source=await readFile(process.env.QA_ACCOUNT_HYDRATION_SOURCE||new URL('../src/lib/authSessionSync.js',import.meta.url),'utf8');
const createAuthSessionSynchronizer=new Function(source.replace('export function','function')+';return createAuthSessionSynchronizer;')();
const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
const builderStart=app.indexOf('function buildAppUser('),builderEnd=app.indexOf('// Guards the new satellite',builderStart);
const buildAppUser=new Function('normaliseDriverProfile','getDriverProfileCompletion',app.slice(builderStart,builderEnd)+';return buildAppUser;')(normaliseDriverProfile,getDriverProfileCompletion);
const session=(id='A',metadata={})=>({access_token:'synthetic-'+id,user:{id,email:id+'@example.invalid',user_metadata:metadata}});
const profile=(id='A',role='driver')=>({data:{id,name:'Synthetic '+id,role},error:null});
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
const tick=async()=>{await Promise.resolve();await Promise.resolve();};

function harness(){
 let listener,stored=null,inCallback=false,unsubscribed=0,readSession=()=>({data:{session:stored},error:null}),readProfile=id=>profile(id);
 const changes=[],tasks=[],builds=[],notices=[],reads=[];
 const record=kind=>{assert.equal(inCallback,false,'Supabase reads must be deferred outside the auth callback');reads.push(kind);};
 const client={auth:{onAuthStateChange:fn=>{listener=fn;return {data:{subscription:{unsubscribe:()=>unsubscribed++}}};},getSession:async()=>{record('session');return readSession(reads.filter(x=>x==='session').length);}},from:table=>{record('profile');assert.equal(table,'profiles');return {select:fields=>{assert.equal(fields,'id, name, role');return {eq:(field,id)=>{assert.equal(field,'id');return {single:()=>readProfile(id)};}};}};}};
 const stop=createAuthSessionSynchronizer({client,buildUser:(p,u)=>{builds.push({profile:p,user:u});return buildAppUser(p,u);},onUser:(user,event)=>changes.push({user,event}),onProfileUnavailable:()=>notices.push('profile'),onRecovery:()=>notices.push('recovery'),defer:fn=>tasks.push(fn)});
 const emit=(event,value)=>{stored=value;inCallback=true;try{listener(event,value);}finally{inCallback=false;}};
 return {changes,tasks,builds,notices,reads,stop,emit,run:()=>{const work=tasks.shift();assert.ok(work,'deferred task exists');return work();},setSession:value=>{stored=value;},sessionReader:fn=>{readSession=fn;},profileReader:fn=>{readProfile=fn;},get current(){return changes.at(-1)?.user;},get unsubscribed(){return unsubscribed;}};
}

test('normal initial/sign-in/refresh/user-update events publish only after both session snapshots and owning profile',async()=>{
 for(const event of ['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED']){const h=harness();h.emit(event,session());assert.equal(h.reads.length,0);await h.run();assert.equal(h.current.id,'A');assert.equal(h.current.role,'driver');assert.deepEqual(h.reads,['session','profile','session']);assert.equal(h.builds.length,1);h.stop();}
});
test('a different account immediately clears the old displayed user before delayed profile loading',async()=>{
 const h=harness();h.emit('SIGNED_IN',session());await h.run();assert.equal(h.current.id,'A');const pending=later();h.profileReader(()=>pending.promise);const n=h.reads.length;h.emit('SIGNED_IN',session('B'));assert.equal(h.current,null);assert.equal(h.changes.at(-1).event,'ACCOUNT_CHANGED');assert.equal(h.reads.length,n);const work=h.run();await tick();assert.equal(h.current,null);pending.resolve(profile('B'));await work;assert.equal(h.current.id,'B');h.stop();
});
test('same-account token refresh keeps the displayed identity while its profile loads',async()=>{
 const h=harness();h.emit('SIGNED_IN',session());await h.run();const shown=h.current,pending=later(),count=h.changes.length;h.profileReader(()=>pending.promise);h.emit('TOKEN_REFRESHED',session());assert.equal(h.changes.length,count);const work=h.run();await tick();assert.equal(h.current,shown);pending.resolve(profile());await work;assert.equal(h.current.id,'A');h.stop();
});
test('A to B to A events cannot publish the first A profile after the final A request',async()=>{
 const h=harness(),pending=later();h.profileReader(()=>pending.promise);h.emit('SIGNED_IN',session());const old=h.run();await tick();h.emit('SIGNED_IN',session('B'));h.emit('SIGNED_IN',session());h.profileReader(id=>profile(id));await h.run();await h.run();const count=h.changes.length;pending.resolve({data:{id:'A',name:'OBSOLETE PROFILE',role:'host'},error:null});await old;assert.equal(h.changes.length,count);assert.equal(h.current.role,'driver');assert.equal(h.builds.length,1);h.stop();
});
test('storage sign-out or account change during profile lookup cannot publish the previous account',async()=>{
 for(const next of [null,session('B'),{}, {user:{}}]){const h=harness(),pending=later();h.profileReader(()=>pending.promise);h.emit('SIGNED_IN',session());const work=h.run();await tick();h.setSession(next);pending.resolve(profile());await work;assert.equal(h.current,null);assert.equal(h.changes.at(-1).event,'SESSION_CHANGED');assert.equal(h.builds.length,0);h.stop();}
});
test('missing, foreign or unsupported profile roles never reach the builder or metadata role fallback',async()=>{
 for(const value of [null,{}, {id:'B',name:'Foreign',role:'host'},{id:'A'}, {id:'A',role:null},{id:'A',role:''},{id:'A',role:'admin'},{id:'A',role:'Host'},{id:'A',role:42}]){const h=harness();h.profileReader(()=>({data:value,error:null}));h.emit('SIGNED_IN',session('A',{role:'host'}));await h.run();assert.equal(h.current,null);assert.equal(h.changes.at(-1).event,'PROFILE_UNAVAILABLE');assert.deepEqual(h.notices,['profile']);assert.equal(h.builds.length,0);assert.deepEqual(h.reads,['session','profile']);h.stop();}
});
test('supported server-owned Driver/Host roles win over editable metadata roles',async()=>{
 for(const role of ['driver','host']){const h=harness();h.profileReader(id=>profile(id,role));h.emit('SIGNED_IN',session('A',{role:role==='driver'?'host':'driver'}));await h.run();assert.equal(h.current.role,role);h.stop();}
});
test('final same-account session supplies the latest metadata instead of stale vehicle/contact values',async()=>{
 const h=harness(),pending=later();h.profileReader(()=>pending.promise);h.emit('TOKEN_REFRESHED',session('A',{phone:'old phone',license_plate:'OLD'}));const work=h.run();await tick();const latest=session('A',{phone:'4165550100',vehicle_make:'Toyota',vehicle_model:'Camry',vehicle_colour:'White',license_plate:'NEW123'});latest.user.email='new@example.invalid';h.setSession(latest);pending.resolve(profile());await work;assert.equal(h.current.phone,'4165550100');assert.equal(h.current.licensePlate,'NEW123');assert.equal(h.current.email,'new@example.invalid');assert.equal(h.builds[0].user,latest.user);h.stop();
});
test('a mismatching initial session snapshot fails closed before any profile read',async()=>{
 const h=harness();h.emit('SIGNED_IN',session());h.setSession(session('B'));await h.run();assert.equal(h.current,null);assert.equal(h.changes.at(-1).event,'SESSION_CHANGED');assert.deepEqual(h.reads,['session']);assert.equal(h.builds.length,0);h.stop();
});
test('final session errors and rejection fail closed without publishing, with a later explicit event able to retry',async()=>{
 for(const rejection of [false,true]){const h=harness();h.sessionReader(n=>{if(n===2){if(rejection)throw Error('Synthetic final session failure');return {data:{session:session()},error:{message:'Synthetic final session error'}};}return {data:{session:session()},error:null};});h.emit('SIGNED_IN',session());await assert.doesNotReject(h.run());assert.equal(h.current,null);assert.equal(h.builds.length,0);assert.equal(h.tasks.length,0);h.emit('SIGNED_IN',session());await h.run();assert.equal(h.current.id,'A');assert.equal(h.builds.length,1);h.stop();}
});
test('an auth change during the final session read invalidates its result',async()=>{
 const h=harness(),pending=later();h.sessionReader(n=>n===2?pending.promise:{data:{session:session(n>2?'B':'A')},error:null});h.emit('SIGNED_IN',session());const work=h.run();await tick();assert.equal(h.reads.filter(x=>x==='session').length,2);h.emit('SIGNED_IN',session('B'));const changes=h.changes.length;pending.resolve({data:{session:session()},error:null});await work;assert.equal(h.changes.length,changes);assert.equal(h.builds.length,0);await h.run();assert.equal(h.current.id,'B');h.stop();
});
test('sign-out during the final session read cannot be undone by that read',async()=>{
 const h=harness(),pending=later();h.sessionReader(n=>n===2?pending.promise:{data:{session:session()},error:null});h.emit('SIGNED_IN',session());const work=h.run();await tick();h.emit('SIGNED_OUT',null);const changes=h.changes.length;pending.resolve({data:{session:session()},error:null});await work;assert.equal(h.changes.length,changes);assert.equal(h.current,null);assert.equal(h.builds.length,0);h.stop();
});
test('recovery during the final session read retains recovery and ignores late profile publication',async()=>{
 const h=harness(),pending=later();h.sessionReader(n=>n===2?pending.promise:{data:{session:session()},error:null});h.emit('SIGNED_IN',session());const work=h.run();await tick();h.emit('PASSWORD_RECOVERY',session('B'));const changes=h.changes.length;pending.resolve({data:{session:session()},error:null});await work;assert.equal(h.changes.length,changes);assert.equal(h.current,null);assert.deepEqual(h.notices,['recovery']);assert.equal(h.builds.length,0);h.stop();
});
test('unsubscribe while the final read is pending prevents all later publication and notices',async()=>{
 for(const rejection of [false,true]){const h=harness(),pending=later();h.sessionReader(n=>n===2?pending.promise:{data:{session:session()},error:null});h.emit('SIGNED_IN',session());const work=h.run();await tick();h.stop();const changes=h.changes.length;if(rejection)pending.reject(Error('Obsolete session error'));else pending.resolve({data:{session:session()},error:null});await assert.doesNotReject(work);assert.equal(h.changes.length,changes);assert.equal(h.builds.length,0);assert.deepEqual(h.notices,[]);assert.equal(h.unsubscribed,1);}
});
test('profile error replies and rejections clear a previous same-account identity without automatic retry',async()=>{
 for(const rejection of [false,true]){const h=harness();h.emit('SIGNED_IN',session());await h.run();h.profileReader(()=>{if(rejection)throw Error('Synthetic profile error');return {data:profile().data,error:{message:'Unavailable'}};});h.emit('TOKEN_REFRESHED',session());await assert.doesNotReject(h.run());assert.equal(h.current,null);assert.deepEqual(h.notices,['profile']);assert.equal(h.tasks.length,0);h.stop();}
});
test('invalid event account IDs clear identity without scheduling a profile or opening recovery',async()=>{
 for(const id of [undefined,null,'','   ',42,true,{}]){const h=harness();h.emit('SIGNED_IN',session());await h.run();h.emit('PASSWORD_RECOVERY',{user:{id}});assert.equal(h.current,null);assert.equal(h.tasks.length,0);assert.deepEqual(h.notices,[]);h.stop();}
});
test('unsupported events with a valid session do not clear or reload the displayed user',async()=>{
 const h=harness();h.emit('SIGNED_IN',session());await h.run();const shown=h.current,count=h.changes.length;h.emit('MFA_CHALLENGE_VERIFIED',session('B'));assert.equal(h.current,shown);assert.equal(h.changes.length,count);assert.equal(h.tasks.length,0);h.stop();
});
test('repeated same-account SIGNED_IN events do not temporarily clear account state',async()=>{
 const h=harness();h.emit('SIGNED_IN',session());await h.run();const count=h.changes.length;h.emit('SIGNED_IN',session());h.emit('SIGNED_IN',session());assert.equal(h.changes.length,count);await h.run();await h.run();assert.equal(h.current.id,'A');assert.equal(h.changes.length,count+1);h.stop();
});
