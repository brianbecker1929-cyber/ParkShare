export const HOST_APPLICATION_REVIEW_EMAIL = 'info@myparkshare.ca';
export const OWNERSHIP_DOCUMENT_BUCKET = 'host-ownership-documents';
export const MAX_OWNERSHIP_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const OWNERSHIP_DOCUMENT_TYPES = Object.freeze({tax:'Property tax bill',mortgage:'Mortgage statement',utility:'Utility bill',license:"Driver’s licence",bank:'Bank statement'});
export const OWNERSHIP_FILE_TYPES = Object.freeze({'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'});
export const APPLICATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function canReviewHostApplications(user) {
  return user?.app_metadata?.parkshare_staff === true || user?.app_metadata?.parkshare_host_approver === true
    || (String(user?.email || '').trim().toLowerCase() === HOST_APPLICATION_REVIEW_EMAIL && Boolean(user?.email_confirmed_at));
}
export function ownershipDocumentError(file,documentType) {
  if(!Object.hasOwn(OWNERSHIP_DOCUMENT_TYPES,documentType))return 'Choose a proof of ownership document type.';
  if(!file || !Object.hasOwn(OWNERSHIP_FILE_TYPES,file.type))return 'Choose a PDF, JPEG, PNG or WebP document.';
  if(!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_OWNERSHIP_DOCUMENT_BYTES)return 'Choose a non-empty document no larger than 5 MB.';
  return null;
}
export async function hostApplicationRequest(client,hostId,body,{method='POST',query='',fetcher=fetch}={}) {
  const {data,error}=await client.auth.getSession();
  if(error||!data?.session?.access_token||data.session.user?.id!==hostId)throw Error('Your account changed. Sign in to the original account again.');
  const response=await fetcher('/api/host-applications'+query,{method,headers:{Authorization:`Bearer ${data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
  const result=await response.json();
  if(!response.ok){const failure=Error(result.error||'The application could not be completed. Please try again.');failure.cleanupAllowed=result.safeToDiscard===true&&response.status===400;throw failure;}
  return result;
}
export async function submitHostApplication(client,payload,fetcher=fetch,hostId) {
  const result=await hostApplicationRequest(client,hostId,{...payload,action:'submit'},{fetcher});
  if(!result.application?.id)throw Error('We could not confirm your application. Check your Host Dashboard before trying again.');
  return result.application;
}
