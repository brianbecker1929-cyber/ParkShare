// Public, transformed photographs for published driveway listings.
// Storage stays private. Never redirect to source files or return source data.
import sharp from 'sharp';
import {supabaseAdmin,jsonMethod} from './_lib.js';
import {validId} from '../src/lib/privateListingAccess.js';
import {embeddedPhotoData} from '../src/lib/publicListings.js';
import {listingPhotoStoragePath} from './_public-listing-photo.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (!jsonMethod(req,res,'GET')) return;
  const id = typeof req.query?.listingId === 'string' ? validId(req.query.listingId) : null;
  const rawPhoto = req.query?.photo;
  if (!id || rawPhoto !== undefined && (typeof rawPhoto !== 'string' || !/^[0-5]$/.test(rawPhoto))) return res.status(400).end();
  const photo = Number(rawPhoto || 0);
  try {
    const result = await supabaseAdmin.from('listings').select(`id,host_id,${photo === 0 ? 'img,' : ''}photo:photos->${photo}`).eq('id',id).maybeSingle();
    if (result.error) throw result.error;
    const listing = result.data;
    if (!listing) return res.status(404).end();
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const primaryValid = photo === 0 && (embeddedPhotoData(listing.img) || listingPhotoStoragePath(listing.img,listing.host_id,supabaseUrl));
    const source = primaryValid ? listing.img : listing.photo;
    const path = listingPhotoStoragePath(source,listing.host_id,supabaseUrl);
    let buffer;
    if (path) {
      const downloaded = await supabaseAdmin.storage.from('listing-photos').download(path);
      if (downloaded.error || !downloaded.data) return res.status(404).end();
      if (downloaded.data.size > 10 * 1024 * 1024) return res.status(413).end();
      buffer = Buffer.from(await downloaded.data.arrayBuffer());
    } else {
      const embedded = embeddedPhotoData(source);
      if (!embedded) return res.status(404).end();
      buffer = Buffer.from(embedded.base64,'base64');
    }
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) return res.status(413).end();
    // Re-encoding strips EXIF/GPS metadata; originals are retained unchanged.
    const preview = await sharp(buffer,{limitInputPixels:40_000_000}).rotate()
      .resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true})
      .webp({quality:75,effort:3}).toBuffer();
    res.setHeader('Content-Type','image/webp');
    res.setHeader('Content-Length',String(preview.length));
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','public, max-age=300, s-maxage=300');
    return res.status(200).send(preview);
  } catch (error) {
    console.error('[listing-photo] Preview unavailable',{listingId:id,code:error?.code});
    return res.status(503).json({error:'Listing photograph temporarily unavailable.'});
  }
}
