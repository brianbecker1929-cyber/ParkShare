import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {computeEmailSpotBoxes, deriveEmailSpotStates, renderParkingSpotImage} from '../api/_driveway-image.js';
import {getListingSpotLayout} from '../src/lib/listingSpotLayout.js';
import {sampleEmailBooking, isEmailPreviewEnvironment} from '../api/_email-preview.js';
import driverPreview from '../api/preview-renter-email.js';
import hostPreview from '../api/preview-host-email.js';

test('email and app use the same physical bay count, identities and private bays for 1-8 spaces',()=>{
  for(let count=1;count<=8;count++){
    for(const listing of [{spaces:count},{spaces:1,spots:Array.from({length:count},(_,i)=>({forRent:i%2===1}))}]){
      const layout=getListingSpotLayout(listing),states=deriveEmailSpotStates(listing);
      assert.deepEqual(states,layout.map(s=>s.forRent));
      assert.equal(states.length,count);
      assert.deepEqual(computeEmailSpotBoxes(states.length).map(b=>b.label),layout.map(s=>s.label));
    }
  }
  assert.deepEqual(deriveEmailSpotStates({spaces:1,spots:[{forRent:false},{forRent:true}]}),[false,true]);
  assert.equal(deriveEmailSpotStates({spaces:100}).length,8);
  assert.deepEqual(deriveEmailSpotStates({spaces:0}),[]);
  assert.deepEqual(deriveEmailSpotStates({spaces:'bad'}),[]);
});
test('dynamic grid has no invented cells, overlap, or pavement overflow for every supported count',()=>{
  for(let count=1;count<=8;count++){
    const boxes=computeEmailSpotBoxes(count);assert.equal(boxes.length,count);
    for(const a of boxes){
      assert.ok(a.x>1065*.23 && a.y>1477*.16);
      assert.ok(a.x+a.w<1065*.76 && a.y+a.h<1477*.82);
      for(const b of boxes)if(a!==b)assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);
      // Selected path labels finish before the approved vehicle starts.
      assert.ok(a.h*.055+7*Math.min(3.7,a.h*.01)<=a.h*.13);
    }
  }
  for(const count of [0,-1,9,Infinity,NaN,'4',2.5])assert.deepEqual(computeEmailSpotBoxes(count),[]);
});
test('unknown layouts and invalid booked labels fail safely instead of drawing a fictitious map',async()=>{
  for(const [states,chosen]of [[[],0],[null,0],[[true],1],[[true],-1],[[true],null],[Array(9).fill(true),0]]){
    await assert.rejects(renderParkingSpotImage(states,chosen),/not present in the listing layout/);
  }
});
test('real PNGs preserve the last booked bay and keep vehicle changes inside that bay at all sizes',async()=>{
  for(const count of [1,2,3,4,6,8]){
    const chosen=count-1,states=Array.from({length:count},(_,i)=>i===chosen);
    const [empty,car]=await Promise.all([
      renderParkingSpotImage(states,chosen),
      renderParkingSpotImage(states,chosen,{vehicle_make:'Lexus',vehicle_model:'LC',vehicle_colour:'Orange'}),
    ]);
    const meta=await sharp(car).metadata();assert.equal(meta.width,1000);assert.equal(meta.format,'png');
    const raw=await sharp(empty).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const photo=await sharp(car).ensureAlpha().raw().toBuffer();
    const b=computeEmailSpotBoxes(count)[chosen],scale=1000/1065;let changed=0;
    for(let y=0;y<raw.info.height;y++)for(let x=0;x<1000;x++){
      const offset=(y*1000+x)*4;
      if(raw.data[offset]!==photo[offset]||raw.data[offset+1]!==photo[offset+1]||raw.data[offset+2]!==photo[offset+2]){
        changed++;
        assert.ok(x>=(b.x-3)*scale&&x<=(b.x+b.w+3)*scale&&y>=(b.y-3)*scale&&y<=(b.y+b.h+3)*scale,`vehicle escaped ${count}-bay layout`);
      }
    }
    assert.ok(changed>1000,`${count}-bay vehicle must be visible`);
  }
});
test('sample layout selectors are bounded and support physical labels A-H',()=>{
  for(let count=1;count<=8;count++){
    const label=String.fromCharCode(64+count),sample=sampleEmailBooking({spaces:String(count),spot:label});
    assert.equal(sample.spotLabel,label);assert.equal(sample.spotStates.length,count);
    assert.equal(sample.spotStates[sample.chosenIndex],true);
  }
  for(const spaces of ['0','9','100','2.5',[],{}])assert.equal(sampleEmailBooking({spaces}).spotStates.length,4);
  assert.equal(sampleEmailBooking({spaces:'1',spot:'H'}).spotLabel,'A');
});
test('preview environment gate permits isolated QA and excludes real production or mismatched projects',()=>{
  const qa={VERCEL_ENV:'production',SUPABASE_URL:'https://biydlfekindgaslgktsx.supabase.co',APP_URL:'https://parkshare-qa.vercel.app',VERCEL_PROJECT_ID:'prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC'};
  assert.equal(isEmailPreviewEnvironment(qa),true);
  assert.equal(isEmailPreviewEnvironment({...qa,SUPABASE_URL:'https://heqxirlsorcztsawaldg.supabase.co'}),true);
  assert.equal(isEmailPreviewEnvironment({VERCEL_ENV:'preview'}),true);
  for(const change of [{VERCEL_PROJECT_ID:'other'},{APP_URL:'https://www.myparkshare.ca'},{SUPABASE_URL:'https://other.supabase.co'}])assert.equal(isEmailPreviewEnvironment({...qa,...change}),false);
  assert.equal(isEmailPreviewEnvironment({VERCEL_ENV:'production'}),false);
});
test('all five sample templates embed the same eight-bay Spot H image without sending or reading data',async()=>{
  const prior=process.env.VERCEL_ENV;process.env.VERCEL_ENV='preview';
  const fetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Preview must not read or send remotely');};
  try{
    let expected;
    for(const template of ['host','confirmation','extension','halfway','ending']){
      const res={code:200,headers:{},status(n){this.code=n;return this;},setHeader(k,v){this.headers[k]=v;},send(v){this.body=v;return this;},end(v){this.body=v;return this;}};
      await (template==='host'?hostPreview:driverPreview)({method:'GET',query:{spaces:'8',spot:'H',template}},res);
      assert.equal(res.code,200);assert.ok(res.body.includes("Spot H"),template+" must preserve Spot H");assert.ok(res.body.includes("SAMPLE BOOKING"));
      const src=/<img[^>]*src="(data:image\/png;base64,[^"]+)"[^>]*width="180"/.exec(res.body)?.[1];
      assert.ok(src);expected||=src;assert.equal(src,expected);assert.equal(res.headers['Cache-Control'],'no-store');
    }
  }finally{globalThis.fetch=fetch;if(prior===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=prior;}
});
