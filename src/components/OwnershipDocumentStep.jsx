import React,{useEffect,useRef,useState} from 'react';
import {OWNERSHIP_DOCUMENT_BUCKET,OWNERSHIP_DOCUMENT_TYPES,ownershipDocumentError,hostApplicationRequest} from '../lib/hostApplication.js';
export default function OwnershipDocumentStep({client,hostId,address,lat,lng,applicationId,onUploaded}){
 const [type,setType]=useState('tax'),[file,setFile]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lifetime=useRef({active:true,generation:0});
 useEffect(()=>{lifetime.current.active=true;return()=>{lifetime.current.active=false;lifetime.current.generation++;};},[]);
 const invalidate=()=>{lifetime.current.generation++;setBusy(false);setError('');onUploaded(null);};
 const upload=async()=>{
  const validation=ownershipDocumentError(file,type);if(validation){setError(validation);return;}
  const work=++lifetime.current.generation,current=()=>lifetime.current.active&&lifetime.current.generation===work;
  setBusy(true);setError('');
  try{
   const started=await hostApplicationRequest(client,hostId,{action:'start-document',address,lat,lng,documentType:type,mime:file.type,size:file.size});
   if(!current())return;
   const result=await client.storage.from(OWNERSHIP_DOCUMENT_BUCKET).uploadToSignedUrl(started.path,started.token,file,{contentType:file.type,cacheControl:'60',upsert:false});
   if(!current())return;if(result.error)throw Error('The private document upload failed. Please try again.');
   const confirmed=await hostApplicationRequest(client,hostId,{action:'confirm-document',applicationId:started.applicationId});
   if(current())onUploaded(confirmed.application.id);
  }catch(failure){if(current())setError(failure.message||'The document could not be uploaded. Please try again.');}
  finally{if(current())setBusy(false);}
 };
 return <section className="ps-host-application-proof">
  <p>Upload proof that you own or manage this property. ParkShare staff will review it with your completed application before your listing can go live.</p>
  <label htmlFor="host-proof-type">Proof of ownership document</label>
  <select id="host-proof-type" value={type} disabled={busy} onChange={event=>{invalidate();setType(event.target.value);}}>{Object.entries(OWNERSHIP_DOCUMENT_TYPES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
  <label htmlFor="host-proof-file">Upload document — PDF, JPEG, PNG or WebP, up to 5 MB</label>
  <input id="host-proof-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={event=>{invalidate();setFile(event.target.files?.[0]||null);}}/>
  <p className="ps-host-application-muted">Your document is private and is not shown to Drivers. Hide account numbers, balances and unrelated details; keep your name and the property address visible.</p>
  {error&&<p role="alert" className="ps-host-application-error">{error}</p>}
  {applicationId?<p role="status" className="ps-host-application-success">✓ Document uploaded privately. Staff approval is still required after you submit your application.</p>
    :<button type="button" disabled={!file||busy} onClick={upload}>{busy?'Uploading privately…':'Upload proof for review'}</button>}
 </section>;
}
