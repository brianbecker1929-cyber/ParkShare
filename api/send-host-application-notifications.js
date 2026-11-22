import {timingSafeEqual} from 'node:crypto';
import {supabaseAdmin} from './_lib.js';
import {sendEmailPayload} from './_email.js';
import {deliverHostApplicationNotifications} from './_host-applications.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(!process.env.CRON_SECRET||!process.env.RESEND_API_KEY||!process.env.EMAIL_FROM)return res.status(503).json({error:'Application notifications are not configured.'});
 const expected=Buffer.from(`Bearer ${process.env.CRON_SECRET}`),actual=Buffer.from(req.headers.authorization||'');
 if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return res.status(401).json({error:'Unauthorized'});
 try{return res.status(200).json(await deliverHostApplicationNotifications(supabaseAdmin,sendEmailPayload));}
 catch{return res.status(503).json({error:'The application notification queue is unavailable.'});}
}
