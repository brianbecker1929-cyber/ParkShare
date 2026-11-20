import assert from 'node:assert/strict';
import {after,before,beforeEach,mock,test} from 'node:test';
import sharp from 'sharp';
process.env.STRIPE_SECRET_KEY='sk_test_cover_fixture';
process.env.SUPABASE_URL='https://private-cover.invalid';
process.env.SUPABASE_ANON_KEY='synthetic-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service';
const HOST='00000000-0000-4000-8000-000000000011',DRIVER='00000000-0000-4000-8000-000000000012',OTHER='00000000-0000-4000-8000-000000000013';
const PHOTO='20000000-0000-4000-8000-000000000001.webp';
const url=host=>`https://private-cover.invalid/storage/v1/object/public/listing-photos/${host}/${PHOTO}`;
let handler,png,actor,listing,booking,requests,storageError,invalidImage;
const response=()=>({code:200,headers:{},status(code){this.code=code;return this;},setHeader(k,v){this.headers[k]=v;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},end(){return this;}});
async function call({auth=true,method='GET',listingId='7',bookingId='42'}={}){const res=response();await handler({method,query:{listingId,bookingId},headers:auth?{authorization:'Bearer synthetic'}:{}},res);return res;}
const downloads=()=>requests.filter(r=>r.path.startsWith('/storage/'));
before(async()=>{
 png=await sharp({create:{width:4,height:4,channels:3,background:'#abcdef'}}).png().toBuffer();
 mock.method(globalThis,'fetch',async(input,options={})=>{
  const target=new URL(typeof input==='string'?input:input.url);assert.equal(target.origin,'https://private-cover.invalid','no live network access');assert.equal(options.method||'GET','GET','photo handler is read-only');
  requests.push({path:target.pathname,query:target.searchParams});
  if(target.pathname==='/auth/v1/user')return Response.json({id:actor,aud:'authenticated'});
  if(target.pathname==='/rest/v1/listings')return Response.json([listing]);
  if(target.pathname==='/rest/v1/bookings')return Response.json([booking]);
  if(target.pathname.startsWith('/storage/v1/object/')){
   assert.ok(target.pathname.endsWith('/listing-photos/'+HOST+'/'+PHOTO),'only the authorized listing Host namespace may be downloaded');
   return storageError?Response.json({message:'Not found',error:'not_found',statusCode:'404'},{status:404}):new Response(invalidImage?Buffer.from('invalid image'):png,{headers:{'Content-Type':'image/png'}});
  }
  assert.fail('Unexpected outbound request '+target.pathname);
 });
 ({default:handler}=await import('../api/listing-cover.js'));
});
beforeEach(()=>{actor=HOST;listing={id:7,host_id:HOST,img:url(HOST)};booking={listing_id:7,renter_id:DRIVER,status:'confirmed',paid_at:'2026-10-20T01:00:00Z',stripe_checkout_session_id:'cs_synthetic'};requests=[];storageError=false;invalidImage=false;});
after(()=>mock.restoreAll());
test('real private cover handler imports, authorizes the Host and produces a private WebP response',async()=>{
 const res=await call();assert.equal(res.code,200);assert.equal(res.headers['Cache-Control'],'private, no-store');assert.equal(res.headers['Content-Type'],'image/webp');assert.equal(res.headers['X-Content-Type-Options'],'nosniff');assert.equal(res.headers.Location,undefined);assert.equal(downloads().length,1);assert.equal((await sharp(res.body).metadata()).format,'webp');assert.equal(+res.headers['Content-Length'],res.body.length);
});
for(const status of ['confirmed','completed'])test('only an entitled paid Driver receives the photo: '+status,async()=>{actor=DRIVER;booking.status=status;const res=await call();assert.equal(res.code,200);assert.equal(downloads().length,1);});
test('signed-out access is denied before any database or Storage read',async()=>{const res=await call({auth:false});assert.equal(res.code,401);assert.equal(requests.length,0);assert.equal(res.headers['Cache-Control'],'private, no-store');});
for(const condition of ['outsider','other-listing','pending','refunded','unpaid'])test('private photo denial performs no Storage download: '+condition,async()=>{
 actor=condition==='outsider'?OTHER:DRIVER;if(condition==='other-listing')booking.listing_id=8;if(['pending','refunded'].includes(condition))booking.status=condition;if(condition==='unpaid')booking.paid_at=null;
 const res=await call();assert.equal(res.code,404);assert.equal(downloads().length,0);assert.equal(res.body,undefined);
});
test('a Host cannot proxy another Host photo by editing their own listing image reference',async()=>{listing.img=url(OTHER);const res=await call();assert.equal(res.code,404);assert.equal(downloads().length,0);});
test('untrusted projects and malformed object paths never download',async()=>{
 for(const img of [url(HOST).replace('private-cover.invalid','foreign.invalid'),url(HOST).replace(PHOTO,'not-a-photo.webp'),url(HOST).replace(PHOTO,'extra/'+PHOTO)]){
  listing.img=img;const res=await call();assert.equal(res.code,404);assert.equal(downloads().length,0);
 }
});
test('authorized historical Base64 photos still render privately without a Storage read',async()=>{listing.img='data:image/png;base64,'+png.toString('base64');actor=DRIVER;const res=await call();assert.equal(res.code,200);assert.equal(downloads().length,0);assert.equal((await sharp(res.body).metadata()).format,'webp');assert.equal(res.headers['Cache-Control'],'private, no-store');});
test('missing or malformed image contents fail closed without returning source bytes',async()=>{
 storageError=true;assert.equal((await call()).code,404);storageError=false;invalidImage=true;const res=await call();assert.equal(res.code,503);assert.ok(!Buffer.isBuffer(res.body));assert.equal(res.headers['Cache-Control'],'private, no-store');
});
test('method and listing ID validation occurs before private reads',async()=>{assert.equal((await call({method:'POST'})).code,405);assert.equal((await call({listingId:'invalid'})).code,400);assert.equal(requests.length,0);});
