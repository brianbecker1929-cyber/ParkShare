import assert from 'node:assert/strict';
import {after,before,beforeEach,mock,test} from 'node:test';
import sharp from 'sharp';
import {PUBLIC_DISCOVERY_COLUMNS} from '../src/lib/publicDiscovery.js';
import {publicDrivewayPhotoUrl} from '../src/lib/publicListings.js';
import {isListingImageUrl} from '../src/lib/listingPhotos.js';
import {buildNavigationUrl} from '../src/lib/navigation.js';

process.env.STRIPE_SECRET_KEY='sk_test_marketplace_fixture';
process.env.SUPABASE_URL='https://marketplace.invalid';
process.env.SUPABASE_ANON_KEY='synthetic-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service';
const HOST='00000000-0000-4000-8000-000000000011',OTHER='00000000-0000-4000-8000-000000000012';
const FILE='20000000-0000-4000-8000-000000000001.webp';
const storageUrl=host=>`https://marketplace.invalid/storage/v1/object/public/listing-photos/${host}/${FILE}`;
let photoHandler,galleryHandler,parkingHandler,image,listing,requests,rows,detailsFail,invalidImage;
const response=()=>({code:200,headers:{},status(code){this.code=code;return this;},setHeader(k,v){this.headers[k]=v;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},end(){return this;}});
async function call(handler,query={listingId:'7'},method='GET'){const res=response();await handler({method,query,headers:{}},res);return res;}
before(async()=>{
  image=await sharp({create:{width:20,height:10,channels:3,background:'#abcdef'}}).withMetadata({orientation:6}).jpeg().toBuffer();
  assert.ok((await sharp(image).metadata()).exif,'fixture includes metadata');
  mock.method(globalThis,'fetch',async(input,options={})=>{
    const target=new URL(typeof input==='string'?input:input.url);
    assert.equal(target.origin,'https://marketplace.invalid','no live external requests');
    requests.push({path:target.pathname,query:target.searchParams,method:options.method||'GET'});
    if(target.pathname==='/rest/v1/rpc/public_parking_page') return Response.json(rows);
    if(target.pathname==='/rest/v1/listings'){
      const select=target.searchParams.get('select');
      if(select===PUBLIC_DISCOVERY_COLUMNS){
        if(detailsFail)return Response.json({message:'Unavailable'},{status:503});
        return Response.json(rows.slice(0,50).map(row=>({...listing,id:row.id})));
      }
      if(select.includes('profiles('))return Response.json(rows.map(row=>({id:row.id,is_paused:false,profiles:{role:'host',stripe_account_id:null}})));
      if(target.searchParams.get('id')!=='eq.7')return Response.json([]);
      const index=Number(/photos->(\d)/.exec(select)?.[1]||0);
      return Response.json([{...listing,photo:listing.photos[index]}]);
    }
    if(target.pathname.startsWith('/storage/v1/object/')){
      assert.ok(target.pathname.endsWith('/listing-photos/'+HOST+'/'+FILE),'only the listing Host photo may be downloaded');
      return new Response(invalidImage?Buffer.from('not an image'):image,{headers:{'Content-Type':'image/jpeg'}});
    }
    assert.fail('Unexpected request '+target.pathname);
  });
  ({default:photoHandler}=await import('../api/listing-photo.js'));
  ({default:galleryHandler}=await import('../api/listing-photos.js'));
  ({default:parkingHandler}=await import('../api/public-parking.js'));
});
beforeEach(()=>{
  listing={id:7,host_id:HOST,title:'Driveway at 123 Main Street',address:'123 Main Street, Toronto, Ontario',lat:43.824194,lng:-79.418116,features:['Covered'],img:'data:image/jpeg;base64,'+image.toString('base64'),photos:[storageUrl(HOST)],description:'PRIVATE GATE CODE',email:'private@example.invalid'};
  rows=[{id:7,price:5,spaces:2,lat:43.82,lng:-79.42,spots:[],time_zone:'America/Toronto',rating:5,review_count:1}];
  requests=[];detailsFail=false;invalidImage=false;
});
after(()=>mock.restoreAll());

test('signed-out discovery shows the exact address, unrounded coordinates and a lightweight image URL',async()=>{
  const result=await call(parkingHandler,{});
  assert.equal(result.code,200);
  const row=result.body.listings[0];
  assert.equal(row.address,listing.address);assert.equal(row.title,listing.title);
  assert.equal(row.lat,listing.lat);assert.equal(row.lng,listing.lng);assert.equal(row.locationPrecision,'exact');
  assert.deepEqual(row.features,['Covered']);assert.equal(row.timeZone,'America/Toronto');
  assert.equal(row.img,'/api/listing-photo?listingId=7');
  for(const hidden of [HOST,'PRIVATE GATE CODE','private@example.invalid','base64,','storage/v1/'])assert.ok(!JSON.stringify(result.body).includes(hidden));
  assert.ok(!requests.some(r=>r.path.includes('/auth/')));
  const route=buildNavigationUrl(row.address,row.lat,row.lng,'Android','google',row.locationPrecision);
  assert.ok(route.includes('destination=43.824194%2C-79.418116'));
});
test('discovery retains the 50-listing page bound and stable cursor without loading original images',async()=>{
  rows=Array.from({length:51},(_,i)=>({...rows[0],id:100-i}));
  const result=await call(parkingHandler,{});
  assert.equal(result.body.listings.length,50);assert.equal(result.body.nextCursor,'51');
  const lookup=requests.find(r=>r.query.get('select')===PUBLIC_DISCOVERY_COLUMNS);
  assert.equal(lookup.query.get('id').match(/\d+/g).length,50);
  assert.ok(!PUBLIC_DISCOVERY_COLUMNS.split(',').includes('img'));
  assert.ok(!requests.some(r=>r.path.startsWith('/storage/')));
});
test('an exact-location lookup failure returns a genuine error rather than rounded or invented listing data',async()=>{
  detailsFail=true;const result=await call(parkingHandler,{});assert.equal(result.code,503);assert.equal(result.body.listings,undefined);
});
test('signed-out legacy photo request returns a transformed WebP with embedded metadata removed',async()=>{
  const result=await call(photoHandler);assert.equal(result.code,200);
  assert.equal(result.headers['Content-Type'],'image/webp');assert.equal(result.headers['X-Content-Type-Options'],'nosniff');
  assert.match(result.headers['Cache-Control'],/^public,/);assert.equal(result.headers.Location,undefined);
  const info=await sharp(result.body).metadata();assert.equal(info.format,'webp');assert.equal(info.exif,undefined);assert.equal(info.orientation,undefined);
  assert.equal(info.width,10);assert.equal(info.height,20,'orientation applied before removing EXIF');
  assert.ok(!requests.some(r=>r.path.includes('/auth/')));
});
test('gallery returns only bounded public image URLs and includes all six supported photographs',async()=>{
  listing.photos=Array.from({length:7},()=>storageUrl(HOST));
  const result=await call(galleryHandler);assert.equal(result.code,200);assert.equal(result.body.photos.length,6);
  assert.deepEqual(result.body.photos.map(isListingImageUrl),Array(6).fill(true));
  for(const hidden of [HOST,'base64,','storage/v1/','PRIVATE GATE CODE'])assert.ok(!JSON.stringify(result.body).includes(hidden));
  assert.equal(result.body.photos[5],'/api/listing-photo?listingId=7&photo=5');
});
test('additional photos proxy the listing Host private Storage without returning its path',async()=>{
  listing.photos.push(storageUrl(HOST));const result=await call(photoHandler,{listingId:'7',photo:'1'});
  assert.equal(result.code,200);assert.equal(requests.filter(r=>r.path.startsWith('/storage/')).length,1);
  assert.equal((await sharp(result.body).metadata()).format,'webp');
});
test('a listing without a primary image can use its first uploaded gallery photograph',async()=>{
  listing.img='🏠';const result=await call(photoHandler);assert.equal(result.code,200);
  assert.equal((await call(galleryHandler)).body.photos.length,1);
});
test('no-image listings have an empty gallery and a clean missing-photo response',async()=>{
  listing.img='🏠';listing.photos=[];assert.equal((await call(photoHandler)).code,404);
  assert.deepEqual((await call(galleryHandler)).body.photos,[]);
});
test('cross-Host, arbitrary-origin and malformed photo references cannot expose private objects',async()=>{
  for(const source of [storageUrl(OTHER),storageUrl(HOST).replace('marketplace.invalid','foreign.invalid'),storageUrl(HOST).replace(FILE,'extra/'+FILE)]){
    listing.img=source;listing.photos=[source];requests=[];
    assert.equal((await call(photoHandler)).code,404);assert.deepEqual((await call(galleryHandler)).body.photos,[]);
    assert.ok(!requests.some(r=>r.path.startsWith('/storage/')));
  }
});
test('malformed IDs, array parameters, unsupported methods and out-of-range photo indexes perform no reads',async()=>{
  for(const id of ['0','01','1 OR 1=1',['7']])assert.equal((await call(photoHandler,{listingId:id})).code,400);
  for(const index of ['-1','6','1.5',['1']])assert.equal((await call(photoHandler,{listingId:'7',photo:index})).code,400);
  assert.equal((await call(galleryHandler,{listingId:['7']})).code,400);
  assert.equal((await call(photoHandler,{listingId:'7'},'POST')).code,405);
  assert.equal(requests.length,0);
});
test('missing listings and undecodable source files never return original photo bytes',async()=>{
  assert.equal((await call(photoHandler,{listingId:'8'})).code,404);
  listing.img=storageUrl(HOST);invalidImage=true;const result=await call(photoHandler);
  assert.equal(result.code,503);assert.equal(Buffer.isBuffer(result.body),false);assert.equal(result.headers['Cache-Control'],'no-store');
});
test('public photo URLs reject invalid image indexes and are recognized by the thumbnail renderer',()=>{
  for(const photo of [0,1,5])assert.equal(isListingImageUrl(publicDrivewayPhotoUrl(7,photo)),true);
  for(const photo of [-1,6,'1'])assert.equal(publicDrivewayPhotoUrl(7,photo),null);
  assert.equal(isListingImageUrl('/api/listing-photo?listingId=7&photo=1&url=https://foreign.invalid'),false);
});
