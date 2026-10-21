// Fixed synthetic examples only: no customer reads, payment actions or sends.
import {refundConfirmedHtml} from './_email.js';
import {refundEmailContext} from './_refund-email-context.js';
import {formatBookingEmailTimes} from './_booking-email-times.js';
import {isEmailPreviewEnvironment} from './_email-preview.js';

export default async function handler(req,res) {
  if (!isEmailPreviewEnvironment()) return res.status(404).end('Not found');
  if (req.method !== 'GET') {res.setHeader('Allow','GET');return res.status(405).end('Method not allowed');}
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Content-Type','text/html; charset=utf-8');
  const cases={
    driver:{status:'refunded',actor:'driver',reason:'Our event was rescheduled.'},
    host:{status:'refunded',actor:'host',reason:'The driveway is unavailable because of maintenance.'},
    unknown:{status:'refunded',actor:null,reason:null},
    partial:{status:'confirmed',amount:500},
    cancelled_partial:{status:'refunded',actor:'host',reason:'The driveway is unavailable.',amount:500},
    extension:{status:'confirmed',extension:true},
    extension_partial:{status:'confirmed',extension:true,amount:500},
    long_reason:{status:'refunded',actor:'host',reason:'Maintenance: '+ 'LongRecordedReason'.repeat(30)},
  };
  const scenario=typeof req.query?.scenario==='string' && Object.hasOwn(cases,req.query.scenario) ? req.query.scenario : 'driver';
  const sample=cases[scenario], audience=req.query?.audience==='host'?'host':'driver';
  const booking={id:'DEMO',status:sample.status,total:12.35,cancelled_by:sample.actor,cancellation_reason:sample.reason};
  const refund={extension_id:sample.extension?5:null,amount_cents:sample.amount||1235};
  const context=refundEmailContext({booking,refund,extension:{added_amount:12.35}});
  const times=formatBookingEmailTimes('2026-10-22T14:00:00Z','2026-10-22T15:00:00Z','2026-10-21T12:00:00Z','America/Toronto');
  let html=refundConfirmedHtml({...context,audience,recipientName:audience==='host'?'Sample Host':'Sample Driver',
    bookingId:'DEMO',refundId:'re_SAMPLE_ONLY',amountCents:refund.amount_cents,address:'12 Example Crescent, Vaughan, Ontario',spotLabel:'F',vehicleDetails:'Honda · Civic · Blue · DEMO 123',
    sessionStart:`${times.entryDateFull}, ${times.startTimeStr}`,sessionEnd:`${times.exitDateFull}, ${times.endTimeStr}`,timeZoneLabel:times.timeZoneLabel,
    bookingOutcome:sample.status==='refunded'?'This booking is cancelled. It no longer reserves a parking space.':'Your booking remains confirmed. Check your booking for the current departure time.',supportEmail:'info@myparkshare.ca'});
  const notice='<div style="background:#FFC107;padding:12px;font:700 13px/1.45 Arial,sans-serif;text-align:center;color:#0E1B2E;">REFUND EMAIL PREVIEW · SAMPLE BOOKING · NO EMAIL SENT</div>';
  html=html.replace(/<body([^>]*)>/i,`<body$1>${notice}`);
  const width=['320','375','390'].includes(req.query?.width)?req.query.width:null;
  if(width){
    const srcdoc=html.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    html=`<!DOCTYPE html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Refund email ${width}px preview</title></head><body style="margin:16px;background:#eee;"><iframe title="Refund email at ${width}px" style="width:${width}px;max-width:100%;height:1600px;border:0;background:white;" srcdoc="${srcdoc}"></iframe></body></html>`;
  }
  return res.status(200).send(html);
}
