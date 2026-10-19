import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('../api/qa-release-status.js',import.meta.url),'utf8')
 .replace('import { supabaseAdmin } from "./_lib.js";','')
 .replace('export default async function handler','return async function handler');
const qa={SUPABASE_URL:'https://biydlfekindgaslgktsx.supabase.co',VITE_SUPABASE_URL:'https://biydlfekindgaslgktsx.supabase.co',
 VERCEL_PROJECT_ID:'prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC',STRIPE_SECRET_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic',
 RESEND_API_KEY:'synthetic',EMAIL_FROM:'Synthetic <qa@example.invalid>',VITE_GOOGLE_MAPS_API_KEY:'synthetic',APP_URL:'https://parkshare-qa.vercel.app',VERCEL_GIT_COMMIT_SHA:'synthetic-commit'};
async function run(overrides={},schemaError=null){let value,code=200;const headers={};
 const admin={from:table=>({select:(fields,options)=>{assert.equal(table,'listings');assert.equal(fields,'id,time_zone');assert.equal(options.head,true);return Promise.resolve({error:schemaError});}})};
 const handler=new Function('supabaseAdmin','process',source)(admin,{env:{...qa,...overrides}});
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
