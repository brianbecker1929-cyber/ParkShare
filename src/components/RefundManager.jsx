import React, {useEffect, useRef, useState} from 'react';
import {CANCELLATION_REASONS,HOST_PARTIAL_REFUND} from '../lib/cancellationReasons.js';
const cad = cents => new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(Number(cents)/100);
export default function RefundManager({user,client}) {
  const [bookingId,setBookingId]=useState(''),[record,setRecord]=useState(null),[reasonCode,setReason]=useState(''),
    [action,setAction]=useState('refund'),[amount,setAmount]=useState(''),[explanation,setExplanation]=useState(''),
    [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[reviews,setReviews]=useState([]);
  const active=useRef(true), locked=useRef(false), requestId=useRef(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const call=async body=>{
    const {data,error}=await client.auth.getSession();
    if(!active.current) return null;
    if(error||data?.session?.user?.id!==user.id) throw new Error('Your session changed. Sign in and reopen refund management.');
    const response=await fetch('/api/cancel-booking',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify(body)});
    const result=await response.json();
    if(!active.current) return null;
    if(!response.ok) throw new Error(result.error||'Unable to process the refund request.');
    return result;
  };
  const run=async work=>{
    if(locked.current)return;locked.current=true;setBusy(true);setNotice('');
    try{await work();}catch(error){if(active.current)setNotice(error.message);}finally{locked.current=false;if(active.current)setBusy(false);}
  };
  const lookup=()=>run(async()=>{const next=await call({bookingId:Number(bookingId.replace(/^PK-/i,'')),action:'lookup'});if(next){setRecord(next);setReason('');setAmount('');setExplanation('');requestId.current=null;}});
  const submit=()=>run(async()=>{
    if(!record||!reasonCode)throw new Error('Choose a booking and reason.');
    const cents=Number(amount)*100;
    if(action==='refund'&&(!/^\d+(\.\d{1,2})?$/.test(amount)||!Number.isSafeInteger(Math.round(cents))))throw new Error('Enter a CAD amount with up to two decimal places.');
    requestId.current ||= crypto.randomUUID();
    const result=await call({bookingId:record.booking.id,action,reasonCode,explanation,amountCents:Math.round(cents),requestId:requestId.current});
    if(!result)return;setNotice(result.message);
    const next=await call({bookingId:record.booking.id,action:'lookup'});if(next)setRecord(next);
    // Keep the same request ID after a timeout/retry. A new amount requires
    // an explicit refresh/review, never silently generates a new refund.
  });
  const reasons=record?.staff?CANCELLATION_REASONS.staff:[HOST_PARTIAL_REFUND];
  const fieldStyle={display:'block',width:'100%',minHeight:44,margin:'6px 0 14px',boxSizing:'border-box'};
  return <section aria-label="Refund management">
    <p>Review a booking before issuing a refund. Partial refunds leave the booking active. Amounts here refer to the original booking payment; paid extensions require separate support review. The Driver receives the refund and the proportional ParkShare service fee.</p>
    {user.isParkShareStaff&&<button type="button" disabled={busy} onClick={()=>run(async()=>{const result=await call({action:'reviews'});if(result)setReviews(result.reviews);})}>Load access problem reports</button>}
    {reviews.map(review=><p key={review.id}><button type="button" disabled={busy} onClick={()=>{setBookingId(String(review.booking_id));setRecord(null);}}>PK-{review.booking_id}</button> {review.explanation||'Access problem reported'}</p>)}
    <label>Booking number<input style={fieldStyle} value={bookingId} disabled={busy} onChange={e=>{setBookingId(e.target.value);setRecord(null);}} placeholder="PK-123"/></label>
    <button type="button" disabled={busy||!bookingId} onClick={lookup}>Review booking / refresh</button>
    {record&&<>
      <p><strong>PK-{record.booking.id}</strong> — {record.booking.status}. Paid {cad(Number(record.booking.total)*100)}, refunded {cad(Number(record.booking.refunded)*100)}.</p>
      {record.staff&&<label>Action<select style={fieldStyle} disabled={busy||Boolean(requestId.current)} value={action} onChange={e=>setAction(e.target.value)}><option value="refund">Partial refund; keep booking active</option><option value="cancel">Cancel and refund remaining payment</option></select></label>}
      <label>Reason<select style={fieldStyle} disabled={busy||Boolean(requestId.current)} value={reasonCode} onChange={e=>setReason(e.target.value)}><option value="">Choose a reason</option>{reasons.map(reason=><option key={reason.code} value={reason.code}>{reason.label}</option>)}</select></label>
      <p>{reasons.find(r=>r.code===reasonCode)?.payer==='parkshare'?'ParkShare reimburses the Host for the corresponding share of the actual original Stripe processing fee.':'The Host retains the original Stripe processing fee cost.'}</p>
      {action==='refund'&&<label>Refund amount (CAD)<input style={fieldStyle} inputMode="decimal" disabled={busy||Boolean(requestId.current)} value={amount} onChange={e=>setAmount(e.target.value)}/></label>}
      <label>{record.staff?'Approval / verified findings':'Explanation'}<textarea style={fieldStyle} maxLength={1000} disabled={busy||Boolean(requestId.current)} value={explanation} onChange={e=>setExplanation(e.target.value)}/></label>
      <button type="button" disabled={busy||!reasonCode||explanation.trim().length<3} onClick={submit}>{busy?'Processing…':action==='cancel'?'Confirm cancellation and remaining refund':'Confirm partial refund'}</button>
      {requestId.current&&<p>Use Review booking / refresh before preparing another refund. Retries of this request use the same reference.</p>}
      <h3>Refund requests and fee reimbursements</h3>
      {record.operations.length===0&&<p>No refund requests recorded here.</p>}
      {record.operations.map(op=><p key={op.id}>{op.reason_code}: {cad(op.amount_cents)} refund — {op.refund_status||'not confirmed yet'}; {op.fee_payer==='host'?'Host covers processing fee':`ParkShare fee reimbursement ${op.fee_credit_cents==null?'awaiting calculation':cad(op.fee_credit_cents)} — ${op.transfer_id?'transferred':op.state==='complete'?'no transfer required':'pending'}`}. {op.state==='review'&&`Staff review required: ${op.review_code}.`}</p>)}
    </>}
    {notice&&<p role="status">{notice}</p>}
  </section>;
}
