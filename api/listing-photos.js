// Lazy gallery metadata for one published listing; never returns raw images.
import {supabaseAdmin,jsonMethod} from './_lib.js';
import {validId} from '../src/lib/privateListingAccess.js';
import {publishedPhotoUrls} from './_public-listing-photo.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (!jsonMethod(req,res,'GET')) return;
  const id = typeof req.query?.listingId === 'string' ? validId(req.query.listingId) : null;
  if (!id) return res.status(400).end();
  try {
    const result = await supabaseAdmin.from('listings').select('id,host_id,img,photos').eq('id',id).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return res.status(404).end();
    const photos = publishedPhotoUrls(result.data,process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
    res.setHeader('Cache-Control','public, max-age=60, s-maxage=60');
    return res.status(200).json({photos});
  } catch (error) {
    console.error('[listing-photos] Gallery unavailable',{listingId:id,code:error?.code});
    return res.status(503).json({error:'Listing photographs temporarily unavailable.'});
  }
}
