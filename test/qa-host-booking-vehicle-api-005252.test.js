import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateBookingVehicle,bookingVehicleMetadata} from '../src/lib/bookingVehicle.js';
import {getBookableVehicles} from '../src/lib/driverProfile.js';
const input={vehicleMake:'Honda',vehicleModel:'Civic',vehicleColour:'Blue',licensePlate:' host 123 '};
const code=(await readFile(new URL('../api/booking-vehicle.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export default async function handler','return async function handler');
function fixture({role='host',anonymous=false,roleError=false,writeError=false,wrongId=false}={}) {
  const writes=[],reads=[];const metadata={role:'driver',name:'Preserved Host',phone:'4165550100',guest_vehicles:[{id:'friend'}],profile_completed_at:'preserved'};
  const admin={from(table){assert.equal(table,'profiles');return {select(fields){assert.equal(fields,'role');return {eq(field,id){reads.push([field,id]);return {maybeSingle:async()=>({data:role?{role}:null,error:roleError?{}:null})};}}}};},auth:{admin:{updateUserById:async(id,patch)=>{writes.push({id,patch});if(writeError)return {error:{}};Object.assign(metadata,patch.user_metadata);return {data:{user:{id:wrongId?'other':id}}};}}}};
  const jsonMethod=(req,res,verb)=>{if(req.method===verb)return true;res.status(405).json({});return false;};
  const requireUser=async(req,res)=>{if(anonymous){res.status(401).json({});return null;}return {id:'self',user_metadata:{...metadata,role:'driver'}};};
  const handler=new Function('jsonMethod','requireUser','supabaseAdmin','validateBookingVehicle','bookingVehicleMetadata',code)(jsonMethod,requireUser,admin,validateBookingVehicle,bookingVehicleMetadata);
  const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(v){this.body=v;return this;}};
  return {writes,reads,metadata,res,run:body=>handler({method:'PATCH',body},res),handler};
}
for(const role of ['host','driver'])test(`${role} saves only their own booking vehicle without changing account fields`,async()=>{
  const f=fixture({role});await f.run({...input,id:'other',userId:'other',role:'admin',name:'ATTACK',phone:'ATTACK',guestVehicles:[],app_metadata:{role:'admin'}});
  assert.equal(f.res.code,200);assert.equal(f.writes.length,1);assert.equal(f.writes[0].id,'self');assert.deepEqual(f.reads,[['id','self']]);
  assert.deepEqual(Object.keys(f.writes[0].patch),['user_metadata']);
  assert.deepEqual(f.writes[0].patch.user_metadata,bookingVehicleMetadata({...input,licensePlate:'HOST 123'}));
  for(const [key,value] of Object.entries({name:'Preserved Host',phone:'4165550100',profile_completed_at:'preserved'}))assert.equal(f.metadata[key],value);
  assert.deepEqual(f.metadata.guest_vehicles,[{id:'friend'}]);assert.equal(f.metadata.role,'driver','metadata role was not overwritten');
  assert.equal(getBookableVehicles(f.metadata)[0].id,'primary');assert.equal(f.res.headers['Cache-Control'],'private, no-store');
});
for(const role of ['admin','',null])test(`unrecognised database role ${role} cannot save via forged metadata`,async()=>{const f=fixture({role});await f.run(input);assert.equal(f.res.code,403);assert.equal(f.writes.length,0);});
test('all vehicle fields are required, normalized, and validated against make/model/colour choices',async()=>{
  for(const value of [{},{...input,vehicleMake:'__proto__'},{...input,vehicleModel:'RAV4'},{...input,vehicleColour:'invalid'},{...input,licensePlate:'<script>'},...Object.keys(input).map(k=>({...input,[k]:''}))]){
    const f=fixture();await f.run(value);assert.equal(f.res.code,400);assert.equal(f.writes.length,0);assert.ok(Object.keys(f.res.body.errors).length);
  }
});
test('anonymous and role lookup errors never mutate; failed or unconfirmed Auth writes never report success',async()=>{
  for(const [options,status,writes] of [[{anonymous:true},401,0],[{roleError:true},500,0],[{writeError:true},500,1],[{wrongId:true},500,1]]){
    const f=fixture(options);await f.run(input);assert.equal(f.res.code,status);assert.equal(f.writes.length,writes);assert.equal(f.res.body.vehicle,undefined);
  }
});
test('non-PATCH calls are rejected before authentication or writes',async()=>{const f=fixture();await f.handler({method:'GET'},f.res);assert.equal(f.res.code,405);assert.equal(f.writes.length,0);assert.equal(f.reads.length,0);});
