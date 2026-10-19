// Host-only publishing: timezone and ownership are derived on the server.
import {jsonMethod,requireUser,supabaseAdmin} from './_lib.js';
import {resolveListingTimeZone} from './_listing-time-zone.js';
import {hostListingRow} from './_host-listing.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(!jsonMethod(req,res,'POST'))return;
  try{
    const user=await requireUser(req,res);if(!user)return;
    const profile=await supabaseAdmin.from('profiles').select('role').eq('id',user.id).maybeSingle();
    if(profile.error)throw profile.error;
    if(profile.data?.role!=='host')return res.status(403).json({error:'Only Hosts can publish driveway listings.'});
    let row;
    try{
      const timeZone=resolveListingTimeZone(req.body);
      if(req.body.preview === true)return res.status(200).json({timeZone});
      row=hostListingRow(req.body,user.id,timeZone,process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL);
    }catch(error){if(error instanceof RangeError)return res.status(400).json({error:error.message});throw error;}
    const result=await supabaseAdmin.from('listings').insert(row).select('id,time_zone').single();
    if(result.error)throw result.error;
    return res.status(201).json({listing:{id:result.data.id,timeZone:result.data.time_zone}});
  }catch(error){
    console.error('[host-listings] publish failed',{code:error?.code});
    return res.status(503).json({error:'We could not confirm publication. Check your Host Dashboard before trying again.'});
  }
}
