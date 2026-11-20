import {publishHostListing} from './hostListingPublish.js';
import {uploadListingPhotos,removeUploadedListingPhotos} from './listingPhotos.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone=value=>JSON.parse(JSON.stringify(value));

// A tab-scoped receipt survives reload without storing a token or photo blobs.
// Keep it until the server confirms a result. A retry uses the exact saved body.
export function createListingPublication({client,hostId,storage,fetcher=fetch,
  upload=uploadListingPhotos,remove=removeUploadedListingPhotos,
  randomId=()=>globalThis.crypto.randomUUID()}){
  const key=`parkshare:listing-publication:${hostId}`;
  let pending=null,inFlight=null,recoveryError=null;
  try{
    storage=storage===undefined?globalThis.sessionStorage:storage;
    if(!storage)throw Error('Tab storage unavailable');
    const saved=storage.getItem(key);
    if(saved){
      pending=JSON.parse(saved);
      if(pending.hostId!==hostId || !UUID.test(pending.payload?.requestId||'') || !Array.isArray(pending.paths))throw Error('Invalid receipt');
    }
  }catch{recoveryError=new Error('Publication recovery details could not be loaded. Check your Host Dashboard and enable tab storage before publishing.');}
  const clear=()=>{pending=null;try{storage.removeItem(key);}catch{/* A stale receipt can only replay the same result. */}};
  async function run(buildPayload,photos,onProgress){
    if(recoveryError)throw recoveryError;
    if(!pending){
      const uploaded=await upload(client,hostId,photos,onProgress);
      try{
        const payload=clone({...buildPayload(uploaded.urls),requestId:randomId()});
        if(!UUID.test(payload.requestId))throw Error('Unable to create a publication request ID.');
        const receipt={hostId,payload,paths:uploaded.paths};
        storage.setItem(key,JSON.stringify(receipt)); // BEFORE the first write request.
        pending=receipt;
      }catch(error){
        try{await remove(client,uploaded.paths);}catch{/* No publication request was made. */}
        throw error;
      }
    }
    const receipt=pending;
    try{
      const listing=await publishHostListing(client,receipt.payload,fetcher,hostId);
      clear();
      return {...listing,address:receipt.payload.address,price:receipt.payload.price,
        spaces:receipt.payload.spots.filter(spot=>spot.forRent).length};
    }catch(error){
      if(error.cleanupAllowed || error.publicationDeleted){
        clear();
        // Only a durable server rejection permits deletion; deletion tombstones
        // already use the existing server cleanup queue.
        if(error.cleanupAllowed)try{await remove(client,receipt.paths);}catch{/* Existing orphan-review procedure applies. */}
      }
      throw error;
    }
  }
  return {
    get pending(){return Boolean(pending||recoveryError);},
    publish(buildPayload,photos,onProgress=()=>{}){
      if(inFlight)return inFlight;
      inFlight=run(buildPayload,photos,onProgress).finally(()=>{inFlight=null;});
      return inFlight;
    },
  };
}
