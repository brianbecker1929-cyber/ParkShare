import React,{useCallback,useEffect,useRef,useState} from 'react';
import {hostApplicationRequest,OWNERSHIP_DOCUMENT_TYPES,APPLICATION_UUID} from '../lib/hostApplication.js';
import {formatAvailabilitySummary} from '../lib/listingAvailability.js';
const labels={submitted:'Awaiting staff approval',approved:'Approved — listing published',rejected:'Corrections requested'};
export default function HostApplicationsView({client,user,review=false,compact=false}){
 const [rows,setRows]=useState([]),[selected,setSelected]=useState(null),[note,setNote]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[filter,setFilter]=useState('submitted'),[docUrl,setDocUrl]=useState('');
 const owner=user?.id,lifetime=useRef({active:true,revision:0,detailRevision:0});
 const request=useCallback((body,options)=>hostApplicationRequest(client,owner,body,options),[client,owner]);
 const load=useCallback(async()=>{
  const rev=++lifetime.current.revision;setLoading(true);setError('');
  try{const result=await request(null,{method:'GET',query:review?`?review=1&status=${filter}`:''});if(lifetime.current.active&&rev===lifetime.current.revision)setRows(result.applications||[]);}
  catch(failure){if(lifetime.current.active&&rev===lifetime.current.revision)setError(failure.message);}
  finally{if(lifetime.current.active&&rev===lifetime.current.revision)setLoading(false);}
 },[request,review,filter]);
 const open=useCallback(async id=>{
  if(!APPLICATION_UUID.test(id))return;
  const rev=++lifetime.current.detailRevision;setError('');setSelected(null);setDocUrl('');setNote('');
  try{const result=await request(null,{method:'GET',query:`?id=${id}${review?'&review=1':''}`});if(lifetime.current.active&&rev===lifetime.current.detailRevision)setSelected(result.application);}
  catch(failure){if(lifetime.current.active&&rev===lifetime.current.detailRevision)setError(failure.message);}
 },[request,review]);
 useEffect(()=>{lifetime.current.active=true;void load();const id=new URLSearchParams(window.location.search).get('application');if(review&&id)void open(id);
  return()=>{lifetime.current.active=false;lifetime.current.revision++;lifetime.current.detailRevision++;};},[load,open,review]);
 const decide=async decision=>{
  if(busy||!selected)return;setBusy(true);setError('');
  try{const result=await request({action:'review',id:selected.id,decision,note});if(!lifetime.current.active)return;setSelected(current=>({...current,...result.application}));await load();}
  catch(failure){if(lifetime.current.active)setError(failure.message);}
  finally{if(lifetime.current.active)setBusy(false);}
 };
 const documentLink=async()=>{if(!selected||busy)return;const revision=lifetime.current.detailRevision;setError('');setDocUrl('');try{const result=await request(null,{method:'GET',query:`?id=${selected.id}&document=1${review?'&review=1':''}`});if(lifetime.current.active&&revision===lifetime.current.detailRevision)setDocUrl(result.url);}catch(failure){if(lifetime.current.active)setError(failure.message);}};
 return <section className={`ps-host-applications${compact?' is-compact':''}`} aria-label={review?'Host application approvals':'Your Host applications'}>
  <div className="ps-host-application-heading"><div><h2>{review?'Host application approvals':'Your applications'}</h2><p>{review?'Review ownership proof and listing details before approving publication.':'New listings stay private until ParkShare staff approves your application.'}</p></div><button type="button" disabled={loading||busy} onClick={load}>Refresh applications</button></div>
  {review&&<label>Show <select value={filter} disabled={busy} onChange={event=>setFilter(event.target.value)}><option value="submitted">Awaiting approval</option><option value="approved">Approved</option><option value="rejected">Corrections requested</option><option value="all">All submitted applications</option></select></label>}
  {error&&<p role="alert" className="ps-host-application-error">{error}</p>}
  {loading?<p role="status">Loading applications…</p>:!rows.length?<p>No {review?'matching ':''}applications to show.</p>:<ul className="ps-host-application-list">{rows.map(row=><li key={row.id}><div><strong>{row.address}</strong><p>{labels[row.status]||row.status}</p>{row.review_note&&<p>{row.review_note}</p>}{review&&row.notification_error&&!row.notification_sent_at&&<p className="ps-host-application-error">Review email needs attention. This application is safely stored in the queue.</p>}</div><button type="button" disabled={busy} onClick={()=>open(row.id)}>{review?'Review application':'View application'}</button></li>)}</ul>}
  {rows.length===50&&<p>Showing 50 applications. Review the pending applications, then refresh to see the next ones.</p>}
  {selected&&<article className="ps-host-application-detail" aria-label="Application details"><h3>{selected.address}</h3><p role="status"><strong>{labels[selected.status]||selected.status}</strong></p>
   {review&&<p>Host: {selected.host_name} — <a href={`mailto:${selected.host_email}`}>{selected.host_email}</a></p>}
   <p>Reference: {selected.id}</p>
   {selected.listing&&<><p><strong>${Number(selected.listing.price).toFixed(2)} CAD/hour · {selected.listing.spaces} rentable space(s)</strong></p><p>{formatAvailabilitySummary(selected.listing.availability)}</p>
    {selected.listing.availability?.exceptions?.length>0&&<details><summary>Special availability dates</summary><pre>{JSON.stringify(selected.listing.availability.exceptions,null,2)}</pre></details>}
    <p>{selected.listing.features?.join(' · ')||'No optional features selected'}</p><p>{selected.listing.description||'No additional description'}</p>
    <div className="ps-host-application-photos">{selected.photos?.map((url,i)=>url?<img key={i} src={url} alt={`Driveway application photo ${i+1}`}/>:<p key={i}>Photo unavailable. Refresh the application before reviewing.</p>)}</div>
    <details><summary>Parking spaces and confirmed location</summary><p>{selected.listing.lat}, {selected.listing.lng} · {selected.listing.time_zone}</p><pre>{JSON.stringify(selected.listing.spots,null,2)}</pre></details></>}
   <p>Ownership proof: {OWNERSHIP_DOCUMENT_TYPES[selected.document_type]||'Document'}{selected.document_uploaded?' — uploaded privately':''}</p>
   <button type="button" onClick={documentLink} disabled={busy||!selected.document_uploaded}>Get private document link</button>
   {docUrl&&<p><a href={docUrl} target="_blank" rel="noopener noreferrer">Open ownership document</a> — this private link expires after one minute.</p>}
   {selected.review_note&&<p><strong>Review note:</strong> {selected.review_note}</p>}
   {review&&selected.status==='submitted'&&<div className="ps-host-application-decision"><label htmlFor="host-application-review-note">Review note — required when requesting corrections</label><textarea id="host-application-review-note" value={note} maxLength={1000} onChange={event=>setNote(event.target.value)} disabled={busy}/><div><button type="button" disabled={busy} onClick={()=>decide('approved')}>{busy?'Saving review…':'Approve and publish'}</button><button type="button" disabled={busy||note.trim().length<10} onClick={()=>decide('rejected')}>Request corrections</button></div><p>Approving publishes this application’s exact listing details. The Host must also have completed Stripe payment setup.</p></div>}
  </article>}
 </section>;
}
