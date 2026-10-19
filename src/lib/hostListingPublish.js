export async function publishHostListing(client,payload,fetcher=fetch){
  const session=await client.auth.getSession();
  if(session.error || !session.data?.session?.access_token){const error=new Error('Sign in with your Host account again before publishing.');error.cleanupAllowed=true;throw error;}
  let response;
  try{
    response=await fetcher('/api/host-listings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.data.session.access_token}`},body:JSON.stringify(payload)});
    const data=await response.json();
    if(!response.ok || !data.listing?.id){const error=new Error(data.error||'We could not confirm publication. Check your Host Dashboard before trying again.');error.cleanupAllowed=response.status>=400&&response.status<500;throw error;}
    return data.listing;
  }catch(error){
    if(error.cleanupAllowed)throw error;
    throw new Error('We could not confirm publication. Check your Host Dashboard before trying again.');
  }
}

export async function requestPropertyTimeZone(client,point,signal,fetcher=fetch){
  const session=await client.auth.getSession();
  if(session.error || !session.data?.session?.access_token)throw new Error('Sign in with your Host account to confirm the driveway location.');
  const response=await fetcher('/api/host-listings',{method:'POST',signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.data.session.access_token}`},body:JSON.stringify({preview:true,lat:point.lat,lng:point.lng})});
  const data=await response.json();
  if(!response.ok || typeof data.timeZone!=='string')throw new Error(data.error||'Unable to confirm this property location. Please try again.');
  return data.timeZone;
}
