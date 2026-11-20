// Host-only publishing: timezone and ownership are derived on the server.
import {jsonMethod,requireUser,supabaseAdmin} from './_lib.js';
import {resolveListingTimeZone} from './_listing-time-zone.js';
import {hostListingRow} from './_host-listing.js';
import {listingPublicationIdentity} from './_listing-publication.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(!jsonMethod(req,res,'POST'))return;
  try{
    const user=await requireUser(req,res);if(!user)return;
    const profile=await supabaseAdmin.from('profiles').select('role').eq('id',user.id).maybeSingle();
    if(profile.error)throw profile.error;
    if(profile.data?.role!=='host')return res.status(403).json({error:'Only Hosts can publish driveway listings.'});
    if(req.body?.preview === true){
      try{return res.status(200).json({timeZone:resolveListingTimeZone(req.body)});}
      catch(error){if(error instanceof RangeError)return res.status(400).json({error:error.message});throw error;}
    }
    let identity;
    try{identity=listingPublicationIdentity(req.body);}
    catch(error){if(error instanceof RangeError)return res.status(400).json({error:error.message,safeToDiscard:true});throw error;}
    const args={p_host_id:user.id,p_request_id:identity.requestId,p_payload_hash:identity.hash};
    const publish=async (row,rejection=null)=>{
      const result=await supabaseAdmin.rpc('publish_host_listing',{...args,p_listing:row,p_rejection:rejection});
      if(result.error)throw result.error;
      return result.data;
    };
    // Resolve a committed result BEFORE date validation or timezone lookup:
    // a lost response may be retried on another calendar day.
    const respond=listing=>listing.rejected
      ?res.status(400).json({error:listing.error,safeToDiscard:true})
      :res.status(listing.replayed?200:201).json({listing});
    const existing=await publish(null);
    if(existing)return respond(existing);
    let row;
    try{
      const timeZone=resolveListingTimeZone(req.body);
      row=hostListingRow(req.body,user.id,timeZone,process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL);
    }catch(error){
      if(error instanceof RangeError)return respond(await publish(null,error.message));
      throw error;
    }
    const listing=await publish(row);
    return respond(listing);
  }catch(error){
    if(error?.code==='P0061')return res.status(409).json({error:'This publication request belongs to different listing details. Check your Host Dashboard before continuing.'});
    if(error?.code==='P0062')return res.status(410).json({error:'This listing was already published and has since been deleted. It will not be published again.',publicationDeleted:true});
    console.error('[host-listings] publish failed',{code:error?.code});
    return res.status(503).json({error:'We could not confirm publication. Check your Host Dashboard before trying again.'});
  }
}
