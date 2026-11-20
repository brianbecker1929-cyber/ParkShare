import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields=['title','address','price','description','features','photos','lat','lng','spots','availability'];
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export function listingPublicationIdentity(body){
  if(!UUID.test(body?.requestId||''))throw new RangeError('Refresh the listing form before publishing. A publication request ID is required.');
  const payload=Object.fromEntries(fields.filter(key=>body[key]!==undefined).map(key=>[key,body[key]]));
  return {requestId:body.requestId.toLowerCase(),hash:createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex')};
}
