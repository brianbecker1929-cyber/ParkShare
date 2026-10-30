import test from 'node:test';
import assert from 'node:assert/strict';
import {validateKey,safePath,digest,copyOne,SOURCE,TARGET} from '../scripts/qa-recovery-storage.mjs';

const jwt=payload=>'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.synthetic';
test('server keys must be privileged and match the fixed project when legacy claims identify it',()=>{
 assert.ok(validateKey('sb_secret_syntheticOnly',TARGET));
 assert.ok(validateKey(jwt({ref:SOURCE,role:'service_role'}),SOURCE));
 for(const key of ['', 'sb_publishable_synthetic',jwt({ref:SOURCE,role:'service_role'}),jwt({ref:TARGET,role:'anon'}),'bad\nkey'])assert.throws(()=>validateKey(key,TARGET));
});
test('private object paths cannot escape their bucket or contain hidden control characters',()=>{
 assert.equal(safePath('synthetic-user/image.jpg'),'synthetic-user/image.jpg');
 for(const path of ['','/image','a/../b','a//b','a\\b','a\nfile'])assert.throws(()=>safePath(path));
});
const bytes=Buffer.from('synthetic-private-image');
const file={path:'synthetic/file.jpg',bytes:bytes.length,sha256:digest(bytes),contentType:'image/jpeg'};
test('different existing target bytes are never overwritten',async()=>{
 let uploads=0;
 const api={download:async()=>({data:new Blob(['different']),error:null}),upload:async()=>{uploads++;}};
 await assert.rejects(copyOne(api,file,bytes),/overwrite refused/);assert.equal(uploads,0);
});
test('a corrupted local checkpoint is rejected before any target access',async()=>{
 let calls=0;const api={download:async()=>{calls++;}};
 await assert.rejects(copyOne(api,file,Buffer.from('corrupt')),/checksum mismatch/);assert.equal(calls,0);
});
test('an identical target file is verified without uploading it again',async()=>{
 let uploads=0;
 const api={download:async()=>({data:new Blob([bytes]),error:null}),upload:async()=>{uploads++;}};
 assert.equal(await copyOne(api,file,bytes),false);assert.equal(uploads,0);
});
test('missing target bytes are uploaded and verified, while permission failures stop the copy',async()=>{
 let payload,uploads=0;
 const api={download:async()=>payload?({data:new Blob([payload]),error:null}):({data:null,error:{statusCode:'404',message:'Object not found'}}),
 upload:async(path,data,options)=>{assert.equal(path,file.path);assert.equal(options.upsert,true);payload=data;uploads++;return {data:{},error:null};}};
 assert.equal(await copyOne(api,file,bytes),true);assert.equal(uploads,1);
 const denied={download:async()=>({data:null,error:{statusCode:'403',message:'synthetic-private-detail'}}),upload:async()=>{throw new Error('must not upload');}};
 await assert.rejects(copyOne(denied,file,bytes),error=>error.message.includes('403')&&!error.message.includes('synthetic-private-detail'));
});
