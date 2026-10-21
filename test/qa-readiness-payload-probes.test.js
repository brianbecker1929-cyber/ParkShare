import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {resolveListingTimeZone} from '../api/_listing-time-zone.js';

const source=await readFile(new URL('../api/qa-release-status.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('const QA_URL')).replace('export default async function handler','async function handler');
async function probe({brokenTable, status=403}={}){
  const requests=[];
  const db=createClient('https://readiness-fixture.invalid','synthetic-service-key',{
    auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init={})=>{
      const url=new URL(input instanceof Request ? input.url : input);
      assert.equal(url.hostname,'readiness-fixture.invalid','No live database reads in this regression');
      const table=url.pathname.split('/').at(-1);requests.push({table,method:init.method,url});
      if(url.pathname.includes('/rpc/'))return Response.json(table==='public_parking_page'?[]:true);
      if(table===brokenTable)return new Response(null,{status});
      // Model the existing data API failure when an unbounded HEAD query
      // still aggregates tens of MB of persisted HTML/CID email payloads.
      if(['booking_reminder_deliveries','refund_email_deliveries'].includes(table)&&url.searchParams.get('limit')!=='0')return new Response(null,{status:503});
      return new Response(null,{status:200,headers:{'Content-Range':'*/0'}});
    }}
  });
  const env={SUPABASE_URL:'https://biydlfekindgaslgktsx.supabase.co',VITE_SUPABASE_URL:'https://biydlfekindgaslgktsx.supabase.co',VERCEL_PROJECT_ID:'prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC',STRIPE_SECRET_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'synthetic',RESEND_API_KEY:'synthetic',EMAIL_FROM:'qa@example.invalid',VITE_GOOGLE_MAPS_API_KEY:'synthetic',APP_URL:'https://parkshare-qa.vercel.app',CRON_SECRET:'synthetic'};
  const handler=new Function('supabaseAdmin','resolveListingTimeZone','process',code+';return handler;')(db,resolveListingTimeZone,{env});
  const res={code:200,setHeader(){},status(value){this.code=value;return this;},json(body){this.body=body;return this;}};
  await handler({method:'GET'},res);return {res,requests};
}
test('schema readiness checks email payload columns without reading archived message bodies',async()=>{
  const {res,requests}=await probe();assert.equal(res.code,200);assert.equal(res.body.ready,true);assert.ok(Object.values(res.body.checks).every(Boolean));
  for(const table of ['booking_reminder_deliveries','refund_email_deliveries']){
    const request=requests.find(r=>r.table===table);assert.equal(request.method,'HEAD');assert.equal(request.url.searchParams.get('limit'),'0');assert.ok(request.url.searchParams.get('select').split(',').includes('payload'));
  }
});
for(const [brokenTable,flag,status] of [['booking_reminder_deliveries','remindersReady',403],['booking_reminder_deliveries','remindersReady',404],['refund_email_deliveries','refundNotificationsReady',503]])test(`bounded readiness still fails closed for ${brokenTable} HTTP ${status}`,async()=>{
  const {res}=await probe({brokenTable,status});assert.equal(res.code,503);assert.equal(res.body.ready,false);assert.equal(res.body.checks[flag],false);
});
