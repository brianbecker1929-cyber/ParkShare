import {createHash} from 'node:crypto';
import {APPLICATION_UUID,HOST_APPLICATION_REVIEW_EMAIL,OWNERSHIP_DOCUMENT_BUCKET,ownershipDocumentError,canReviewHostApplications} from '../src/lib/hostApplication.js';
import {hostListingRow} from './_host-listing.js';
import {resolveListingTimeZone} from './_listing-time-zone.js';
import {listingPublicationIdentity} from './_listing-publication.js';
export class ApplicationError extends Error {constructor(status,message){super(message);this.status=status;}}
export function propertyApplicationKey(value){
  const address=String(value?.address||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  if(address.length<5||address.length>500)throw new ApplicationError(400,'Complete the property address first.');
  resolveListingTimeZone(value);
  return createHash('sha256').update(JSON.stringify({address,lat:value.lat,lng:value.lng})).digest('hex');
}
export function validOwnershipBytes(bytes,mime){
  const b=Buffer.from(bytes);
  if(mime==='application/pdf')return b.subarray(0,5).toString()==='%PDF-';
  if(mime==='image/jpeg')return b.length>3&&b[0]===255&&b[1]===216&&b[2]===255;
  if(mime==='image/png')return b.length>8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  return mime==='image/webp'&&b.length>12&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';
}
export async function applicationRpc(db,action,actor,id=null,data={}){
  const result=await db.rpc('host_listing_application',{p_action:action,p_actor_id:actor,p_application_id:id,p_data:data});
  if(result.error)throw result.error;return result.data;
}
const view=a=>({id:a.id,status:a.status,address:a.address,submitted_at:a.submitted_at,review_note:a.review_note,listing_id:a.listing_id,
  document_type:a.document_type,document_uploaded:Boolean(a.document_uploaded_at),notification_sent:Boolean(a.notification_sent_at),notification_error:a.notification_error||null});
function applicationId(value){if(!APPLICATION_UUID.test(value||''))throw new ApplicationError(400,'Choose a valid application.');return value.toLowerCase();}
export async function deliverHostApplicationNotifications(db,send,{id=null,limit=5}={}){
  const {data:jobs,error}=await db.rpc('claim_host_application_notifications',{p_application_id:id,p_limit:limit});if(error)throw error;
  const results={sent:0,failed:0};
  for(const job of jobs||[]){
    let providerId=null,failure=null;
    try{
      if(JSON.stringify(job.payload?.to)!==JSON.stringify([HOST_APPLICATION_REVIEW_EMAIL])||job.payload?.attachments?.length)throw Error('invalid_destination');
      const result=await send(job.payload,{idempotencyKey:`parkshare-host-application-${job.id}`});
      if(typeof result?.id!=='string'||!result.id)throw Error('provider_unconfirmed');providerId=result.id;
    }catch{failure='review_email_unconfirmed';}
    const saved=await db.rpc('finish_host_application_notification',{p_id:job.id,p_claim:job.claim,p_provider_id:providerId,p_error:failure});
    if(saved.error||!saved.data||!providerId)results.failed++;else results.sent++;
  }
  return results;
}
export function createHostApplicationsHandler({db,requireUser,stripe,buildEmailPayload,sendEmailPayload,getOrigin,storageUrl}){
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
    try{
      const user=await requireUser(req,res);if(!user)return;
      const reviewer=canReviewHostApplications(user),query=req.query||{},input=req.body||{};
      if(req.method==='GET'){
        const reviewing=query.review==='1';if(reviewing&&!reviewer)throw new ApplicationError(403,'Sign in with your ParkShare approval account.');
        if(!query.id){const rows=await applicationRpc(db,'list',user.id,null,{review:reviewing,status:['submitted','approved','rejected','all'].includes(query.status)?query.status:'submitted'});return res.status(200).json({applications:rows||[]});}
        const a=await applicationRpc(db,'get',user.id,applicationId(query.id));
        if(query.document==='1'){
          if(!a.document_uploaded_at)throw new ApplicationError(404,'The ownership document is not available.');
          const {data,error}=await db.storage.from(OWNERSHIP_DOCUMENT_BUCKET).createSignedUrl(a.document_path,60);
          if(error||!data?.signedUrl)throw new ApplicationError(503,'The document could not be opened. Please try again.');
          return res.status(200).json({url:data.signedUrl});
        }
        const photos=await Promise.all((a.listing_payload?.photos||[]).map(async url=>{
          const prefix=new URL('/storage/v1/object/public/listing-photos/',storageUrl).href;
          if(typeof url!=='string'||!url.startsWith(prefix+a.host_id+'/'))return null;
          const path=url.slice(prefix.length);if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(path))return null;
          const {data,error}=await db.storage.from('listing-photos').createSignedUrl(path,300);return error?null:data?.signedUrl||null;
        }));
        return res.status(200).json({application:{...view(a),listing:a.listing_payload,photos,host_name:reviewer?a.host_name:undefined,host_email:reviewer?a.host_email:undefined}});
      }
      if(input.action==='review'){
        if(!reviewer)throw new ApplicationError(403,'Sign in with your ParkShare approval account.');
        const id=applicationId(input.id),a=await applicationRpc(db,'get',user.id,id);
        if(!['approved','rejected'].includes(input.decision))throw new ApplicationError(400,'Choose approve or reject.');
        const note=typeof input.note==='string'?input.note.trim():'';
        if(note.length>1000||(input.decision==='rejected'&&note.length<10))throw new ApplicationError(400,'Provide a clear review note of 10–1,000 characters when rejecting an application.');
        if(input.decision==='approved'&&a.status!=='approved'){
          hostListingRow(a.listing_payload,a.host_id,resolveListingTimeZone(a.listing_payload),storageUrl);
          const profile=await db.from('profiles').select('stripe_account_id').eq('id',a.host_id).single();
          if(profile.error)throw profile.error;
          if(!profile.data?.stripe_account_id)throw new ApplicationError(409,'The Host must complete Stripe payment setup before this listing can be approved.');
          const account=await stripe.accounts.retrieve(profile.data.stripe_account_id);
          const complete=account.details_submitted===true&&account.charges_enabled===true&&account.payouts_enabled===true;
          const saved=await db.from('profiles').update({stripe_onboarding_complete:complete,stripe_charges_enabled:account.charges_enabled===true,stripe_payouts_enabled:account.payouts_enabled===true}).eq('id',a.host_id);
          if(saved.error)throw saved.error;
          if(!complete)throw new ApplicationError(409,'The Host must finish Stripe verification and payment setup before approval.');
        }
        const reviewed=await applicationRpc(db,'review',user.id,id,{decision:input.decision,note});
        return res.status(200).json({application:view(reviewed)});
      }
      const profile=await db.from('profiles').select('role').eq('id',user.id).maybeSingle();if(profile.error)throw profile.error;
      if(profile.data?.role!=='host')throw new ApplicationError(403,'A Host account is required to submit a driveway application.');
      if(input.action==='start-document'){
        const error=ownershipDocumentError({type:input.mime,size:input.size},input.documentType);if(error)throw new ApplicationError(400,error);
        const key=propertyApplicationKey(input);
        const a=await applicationRpc(db,'start',user.id,null,{propertyKey:key,address:input.address,documentType:input.documentType,mime:input.mime,size:input.size});
        const signed=await db.storage.from(OWNERSHIP_DOCUMENT_BUCKET).createSignedUploadUrl(a.document_path);
        if(signed.error||!signed.data?.token)throw new ApplicationError(503,'The private document upload could not be started. Please try again.');
        return res.status(201).json({applicationId:a.id,path:a.document_path,token:signed.data.token});
      }
      const id=applicationId(input.applicationId),a=await applicationRpc(db,'get',user.id,id);
      if(a.host_id!==user.id)throw new ApplicationError(403,'Application unavailable.');
      if(input.action==='confirm-document'){
        const downloaded=await db.storage.from(OWNERSHIP_DOCUMENT_BUCKET).download(a.document_path);
        if(downloaded.error||!downloaded.data||downloaded.data.size!==a.document_size||!validOwnershipBytes(await downloaded.data.arrayBuffer(),a.document_mime))throw new ApplicationError(400,'The uploaded document is not a valid PDF or image. Choose the original file and try again.');
        const confirmed=await applicationRpc(db,'confirm',user.id,id);return res.status(200).json({application:view(confirmed)});
      }
      if(input.action!=='submit')throw new ApplicationError(400,'Unknown application action.');
      const identity=listingPublicationIdentity(input);
      if(a.status!=='draft'){
        const replay=await applicationRpc(db,'submit',user.id,id,{requestId:identity.requestId,hash:identity.hash});
        if(replay.rejected)return res.status(400).json({error:replay.error,safeToDiscard:true});
        return res.status(200).json({application:view(replay)});
      }
      let listing,key;
      try {
        listing=hostListingRow(input,user.id,resolveListingTimeZone(input),storageUrl);
        key=propertyApplicationKey(listing);
        if(key!==a.property_key||!a.document_uploaded_at)throw new ApplicationError(400,'Upload ownership proof for the confirmed property before submitting.');
      } catch(validation) {
        if(!(validation instanceof RangeError)&&!(validation instanceof ApplicationError&&validation.status===400))throw validation;
        const result=await applicationRpc(db,'submit',user.id,id,{requestId:identity.requestId,hash:identity.hash,rejection:validation.message});
        if(result.rejected)return res.status(400).json({error:result.error,safeToDiscard:true});
        return res.status(200).json({application:view(result)});
      }
      const origin=getOrigin(req);
      const notification=buildEmailPayload({to:HOST_APPLICATION_REVIEW_EMAIL,subject:`ParkShare Host application ${id.slice(0,8)} — approval required`,
        html:`<h2>New ParkShare Host application</h2><p>A completed driveway application is awaiting ParkShare staff review. No listing is live yet.</p><p><a href="${origin}/host-applications?application=${id}">Sign in to review the application</a></p><p>Review the listing and privately stored ownership document, then choose Approve and publish or Request corrections. Documents are not attached to this email.</p>`});
      const submitted=await applicationRpc(db,'submit',user.id,id,{requestId:identity.requestId,hash:identity.hash,propertyKey:key,listing,notification});
      if(submitted.rejected)return res.status(400).json({error:submitted.error,safeToDiscard:true});
      try{await deliverHostApplicationNotifications(db,sendEmailPayload,{id,limit:1});}catch{/* The durable queue retries without creating another application. */}
      return res.status(201).json({application:view(submitted)});
    }catch(error){
      if(error instanceof ApplicationError)return res.status(error.status).json({error:error.message});
      if(error instanceof RangeError)return res.status(400).json({error:error.message});
      if(error?.code==='42501')return res.status(403).json({error:'This application is unavailable to this account.'});
      if(['P0061','P0072','P0074'].includes(error?.code))return res.status(409).json({error:error.message});
      if(error?.code==='P0073')return res.status(429).json({error:error.message});
      if(error?.code==='22023')return res.status(400).json({error:error.message});
      console.error('host-applications: request failed',{code:error?.code||'unavailable'});
      return res.status(503).json({error:'The application service is temporarily unavailable. Check your Host Dashboard before submitting again.'});
    }
  };
}
