import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('../api/qa-release-status.js',import.meta.url),'utf8')
 .replace('import { supabaseAdmin } from "./_lib.js";','')
 .replace('import {resolveListingTimeZone} from "./_listing-time-zone.js";','')
 .replace('export default async function handler','return async function handler');
const qa={SUPABASE_URL:'https://biydlfekindgaslgktsx.supabase.co',VITE_SUPABASE_URL:'https://biydlfekindgaslgktsx.supabase.co',
 VERCEL_PROJECT_ID:'prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC',STRIPE_SECRET_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic',
 RESEND_API_KEY:'synthetic',EMAIL_FROM:'Synthetic <qa@example.invalid>',VITE_GOOGLE_MAPS_API_KEY:'synthetic',APP_URL:'https://parkshare-qa.vercel.app',VERCEL_GIT_COMMIT_SHA:'synthetic-commit',CRON_SECRET:'synthetic-cron-secret'};
async function run(overrides={},schemaError=null){let value,code=200;const headers={};
 const admin={rpc:async(name,args)=>{assert.ok(["public_parking_page","listing_timezone_assignment_ready","listing_publication_ready"].includes(name));if(name==="public_parking_page")assert.deepEqual(args,{p_before_id:1});return {error:null,data:true};},from:table=>({select:(fields,options)=>{assert.ok(['listings','listing_photo_cleanup','payment_refunds','bookings','booking_extensions'].includes(table));assert.equal(fields,({listings:'id,time_zone',listing_photo_cleanup:'object_path',payment_refunds:'refund_id',bookings:'application_state,checkout_rejection_reason,refund_ledger_revision,refund_total_amount,refund_pending_amount',booking_extensions:'application_state,refund_ledger_revision,refund_total_amount,refund_pending_amount'})[table]);assert.equal(options.head,true);return Promise.resolve({error:table==='listings'?schemaError:null});}})};
 const handler=new Function('supabaseAdmin','process','resolveListingTimeZone',source)(admin,{env:{...qa,...overrides}},point=>point.lng===23.59?'Europe/Bucharest':'America/Toronto');
 await handler({method:'GET'},{setHeader:(k,v)=>{headers[k]=v;},status(c){code=c;return this;},json(v){value=v;}});return {value,code,headers};}
test('QA readiness verifies configuration and schema without returning credentials or rows',async()=>{
 const {value,code,headers}=await run();assert.equal(code,200);assert.equal(value.ready,true);assert.equal(value.commit,'synthetic-commit');
 assert.equal(headers['Cache-Control'],'private, no-store');const json=JSON.stringify(value);for(const secret of ['sk_test_synthetic','whsec_synthetic','qa@example.invalid'])assert.ok(!json.includes(secret));
});
test('QA readiness endpoint is unavailable on the production project/database',async()=>{
 for(const env of [{SUPABASE_URL:'https://production.invalid'},{VERCEL_PROJECT_ID:'production-project'}])assert.equal((await run(env)).code,404);
});
test('a live Stripe key cannot pass QA readiness',async()=>{const r=await run({STRIPE_SECRET_KEY:'sk_live_synthetic'});assert.equal(r.code,503);assert.equal(r.value.checks.stripeTestMode,false);});
test('a missing required schema column blocks readiness',async()=>{const r=await run({}, {code:'42703'});assert.equal(r.code,503);assert.equal(r.value.checks.schemaReady,false);});

test('photo cleanup configuration is required for QA readiness',async()=>{const r=await run({CRON_SECRET:''});assert.equal(r.code,503);assert.equal(r.value.checks.photoCleanupReady,false);});
