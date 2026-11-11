import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHostListingJournal,listingEditMatches} from '../src/lib/hostListingState.js';
const storage=()=>{const rows=new Map();return {rows,getItem:k=>rows.get(k),setItem:(k,v)=>rows.set(k,v)};};
const rows=[{id:'db-7',title:'Existing',price:12},{id:'db-8',title:'Other',price:14}];
test('BUG-005488 confirmed delete survives immediate reload, preserves other cards and stays Host-scoped',()=>{
 const s=storage(),a=createHostListingJournal('A',s);a.remove('db-7');assert.deepEqual(a.reconcile(rows),[rows[1]]);assert.deepEqual(createHostListingJournal('A',s).reconcile(rows),[rows[1]]);assert.deepEqual(createHostListingJournal('B',s).reconcile(rows),rows);assert.deepEqual(JSON.parse([...s.rows.values()][0]),[7]);assert.doesNotMatch(JSON.stringify([...s.rows]),/Existing|price|token|address|plate/);
});
test('unavailable edit hides only this view and does not persist an unproven deletion',()=>{
 const s=storage(),j=createHostListingJournal('A',s);j.hide('db-7');j.remove('db-8');assert.equal(j.reconcile(rows).length,0);assert.deepEqual(createHostListingJournal('A',s).reconcile(rows),[rows[0]]);
});
test('confirmed saves win over older reads while deletion wins over old saves',()=>{
 const j=createHostListingJournal('A',null),saved={price:15,description:'Saved',features:['CCTV'],spots:[{id:'A',forRent:true}],spaces:1,host_id:'DO NOT COPY'};j.save(7,saved);saved.features.push('Gated');const read=j.reconcile(rows);assert.equal(read[0].price,15);assert.deepEqual(read[0].features,['CCTV']);assert.equal(read[0].host_id,undefined);read[0].features.push('EV');assert.deepEqual(j.reconcile(rows)[0].features,['CCTV']);j.remove(7);j.save(7,saved);assert.deepEqual(j.reconcile(rows),[rows[1]]);
});
test('corrupt/blocked storage and invalid IDs fail safely with bounded ID-only persistence',()=>{
 for(const value of ['{}','bad',JSON.stringify([null,-1,'7',true]),'x'.repeat(20001)]){const s={getItem:()=>value,setItem(){}};assert.deepEqual(createHostListingJournal('A',s).reconcile(rows),rows);}
 const s=storage(),j=createHostListingJournal('A',s);for(let id=1;id<=300;id++)j.remove(id);assert.equal(JSON.parse([...s.rows.values()][0]).length,256);for(const id of ['db-x',0,-1,1.5])j.remove(id);assert.equal(JSON.parse([...s.rows.values()][0]).length,256);
 const blocked=createHostListingJournal('A',{getItem(){throw Error('blocked');},setItem(){throw Error('quota');}});blocked.remove(7);assert.deepEqual(blocked.reconcile(rows),[rows[1]]);const anonymous=createHostListingJournal(null,s);anonymous.remove(7);assert.deepEqual(anonymous.reconcile(rows),rows);
});
test('canonical fallback compares all editable values without depending on JSON object-key ordering',()=>{
 const changes={price:12,spaces:1,description:'Saved',features:['CCTV'],spots:[{id:'A',forRent:true,bounds:{north:1,south:0}}]};const row={...changes,price:'12.00',spots:[{bounds:{south:0,north:1},forRent:true,id:'A'}]};assert.equal(listingEditMatches(row,changes),true);for(const value of [{price:13},{spaces:2},{description:'Old'},{features:[]},{spots:[{...changes.spots[0],forRent:false}]}])assert.equal(listingEditMatches({...row,...value},changes),false);
});
const source=(await readFile(new URL('../api/account-bookings.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export default async function handler','return async function handler');
test('all account API exits, including empty Host data, invalid requests and failures, are private no-store',async()=>{
 for(const kind of ['empty','unauthenticated','invalid','method','database']){
  let queries=0;const admin={from:()=>{queries++;return {select:()=>({eq:()=>({limit:async()=>kind==='database'?{error:{code:'synthetic'}}:{data:[]}})})};}};
  const handler=new Function('jsonMethod','requireUser','supabaseAdmin','console',source)((req,res)=>{if(kind!=='method')return true;res.status(405).json({});return false;},async(req,res)=>{if(kind!=='unauthenticated')return {id:'A'};res.status(401).json({});return null;},admin,{error(){}});
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(b){this.body=b;return this;}};await handler({method:'GET',query:{view:kind==='invalid'?'x':'host'}},res);assert.equal(res.headers['Cache-Control'],'private, no-store');assert.equal(res.code,{empty:200,unauthenticated:401,invalid:400,method:405,database:503}[kind]);if(kind==='empty')assert.deepEqual(res.body,{listings:[],bookings:[],reviews:[]});
 }
});

test('new dashboard reads respect newer server values instead of replaying a prior edit forever',()=>{
 const j=createHostListingJournal('A',null),before=j.version;j.save(7,{price:15,description:'Saved',features:[],spots:[],spaces:1});assert.equal(j.reconcile(rows,before)[0].price,15);const fresh=j.version;assert.equal(j.reconcile([{...rows[0],price:18}],fresh)[0].price,18);
});
