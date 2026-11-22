import test from 'node:test';
import assert from 'node:assert/strict';
import {canReviewHostApplications,ownershipDocumentError,hostApplicationRequest,submitHostApplication} from '../src/lib/hostApplication.js';
import {propertyApplicationKey,validOwnershipBytes} from '../api/_host-applications.js';
const HOST='10000000-0000-4000-8000-000000000001';
test('approval access uses the verified review inbox or trusted app metadata, never user metadata or a profile role',()=>{
 assert.equal(canReviewHostApplications({email:'INFO@myparkshare.ca',email_confirmed_at:'synthetic'}),true);
 for(const user of [{email:'info@myparkshare.ca'},{email:'attacker@example.invalid',email_confirmed_at:'synthetic',user_metadata:{parkshare_staff:true}},{role:'host'},{role:'staff'}])assert.equal(canReviewHostApplications(user),false);
 assert.equal(canReviewHostApplications({app_metadata:{parkshare_staff:true}}),true);
});
test('private ownership uploads accept only bounded document types and matching file signatures',()=>{
 assert.equal(ownershipDocumentError({size:100,type:'application/pdf'},'tax'),null);
 for(const f of [{size:0,type:'application/pdf'},{size:5242881,type:'image/png'},{size:100,type:'text/html'}])assert.ok(ownershipDocumentError(f,'tax'));
 assert.ok(ownershipDocumentError({size:100,type:'application/pdf'},'unsupported'));
 assert.equal(validOwnershipBytes(Buffer.from('%PDF-1.4\nsynthetic'),'application/pdf'),true);
 assert.equal(validOwnershipBytes(Buffer.from('<html>not proof</html>'),'application/pdf'),false);
 assert.equal(validOwnershipBytes(Buffer.from([137,80,78,71,13,10,26,10,0]),'image/png'),true);
 assert.equal(validOwnershipBytes(Buffer.from([255,216,255,224]),'image/jpeg'),true);
 assert.equal(validOwnershipBytes(Buffer.from('RIFF1234WEBPdata'),'image/webp'),true);
});
test('ownership evidence is bound to both normalized property address and confirmed coordinates',()=>{
 const base={address:'123 Test Street, Toronto ON M5V 2T6',lat:43.65,lng:-79.38};
 assert.equal(propertyApplicationKey(base),propertyApplicationKey({...base,address:' 123  TEST Street, Toronto ON M5V 2T6 '}));
 assert.notEqual(propertyApplicationKey(base),propertyApplicationKey({...base,address:'124 Test Street, Toronto ON M5V 2T6'}));
 assert.notEqual(propertyApplicationKey(base),propertyApplicationKey({...base,lat:43.66}));
});
test('an account switch blocks private upload and application requests before any network call',async()=>{
 let called=false;const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic',user:{id:'other'}}}})}};
 await assert.rejects(()=>hostApplicationRequest(client,HOST,{action:'submit'},{fetcher:async()=>{called=true;}}),/account changed/);assert.equal(called,false);
});
test('application submission uses its own authenticated endpoint and honors only explicit durable cleanup permissions',async()=>{
 const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic',user:{id:HOST}}}})}};
 let sent;const application=await submitHostApplication(client,{requestId:'synthetic',applicationId:'synthetic'},async(url,options)=>{sent={url,options};return Response.json({application:{id:'synthetic-app',status:'submitted'}});},HOST);
 assert.equal(application.status,'submitted');assert.equal(sent.url,'/api/host-applications');assert.equal(JSON.parse(sent.options.body).action,'submit');assert.equal(sent.options.headers.Authorization,'Bearer synthetic');
 await assert.rejects(()=>submitHostApplication(client,{},async()=>Response.json({error:'Correct the application',safeToDiscard:true},{status:400}),HOST),error=>error.cleanupAllowed===true);
 await assert.rejects(()=>submitHostApplication(client,{},async()=>Response.json({error:'Unknown result'},{status:503}),HOST),error=>!error.cleanupAllowed);
});
