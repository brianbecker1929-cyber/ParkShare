import test from "node:test";
import assert from "node:assert/strict";
import {configureWorkers, validateWorkerEnvironment, QA_PROJECT, QA_PREVIEW} from "../scripts/qa-recovery-preview-workers.mjs";

const ready = {
  VERCEL_ENV:"preview", VERCEL_PROJECT_ID:"prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC",
  VERCEL_GIT_COMMIT_REF:"qa/recovery-preflight-oct27",
  SUPABASE_URL:`https://${QA_PROJECT}.supabase.co`, APP_URL:QA_PREVIEW,
  STRIPE_SECRET_KEY:"sk_test_fixture_only", SUPABASE_SERVICE_ROLE_KEY:"fixture_service_only", SUPABASE_ANON_KEY:"fixture_anon_only",
  CRON_SECRET:"fixture_cron_secret_only",
};

test("QA workers refuse every wrong environment before any credential-bearing request", async()=>{
  for(const [key,value] of [
    ["VERCEL_ENV","production"], ["VERCEL_PROJECT_ID","production-project"],
    ["VERCEL_GIT_COMMIT_REF","main"], ["SUPABASE_URL","https://oyxrussraxjgqwzpwyca.supabase.co"],
    ["SUPABASE_URL","https://biydlfekindgaslgktsx.supabase.co"],
    ["APP_URL","https://www.myparkshare.ca"], ["STRIPE_SECRET_KEY","sk_live_fixture_only"],
    ["STRIPE_SECRET_KEY",""], ["SUPABASE_SERVICE_ROLE_KEY",""], ["SUPABASE_ANON_KEY",""], ["CRON_SECRET","short"],
  ]) {
    let called=false;
    await assert.rejects(configureWorkers({...ready,[key]:value},async()=>{called=true;}),/QA worker/);
    assert.equal(called,false,key);
  }
});
test("valid QA Preview configuration uses only the fixed recovery RPC and returns no credentials",async()=>{
  let called=0;
  const result=await configureWorkers(ready,async(url,init)=>{
    called++;
    if (url.includes("/http_request_queue")) {
      assert.equal(init.headers["Accept-Profile"],"net");
      assert.equal(init.headers.apikey,ready.SUPABASE_ANON_KEY);
      assert.doesNotMatch(JSON.stringify(init),/fixture_service_only|fixture_cron_secret_only/);
      return Response.json({code:"PGRST106"},{status:406});
    }
    assert.equal(url,`https://${QA_PROJECT}.supabase.co/rest/v1/rpc/configure_qa_recovery_preview_workers`);
    assert.equal(init.method,"POST");assert.equal(init.headers.Authorization,`Bearer ${ready.SUPABASE_SERVICE_ROLE_KEY}`);
    assert.deepEqual(JSON.parse(init.body),{p_cron_secret:ready.CRON_SECRET});
    return Response.json({configured:true,workers:2});
  });
  assert.equal(called,2);assert.deepEqual(result,{configured:true,workers:2});
  assert.doesNotMatch(JSON.stringify(result),/fixture/);
});
test("provider failures and malformed responses cannot print supplied secrets",async()=>{
  for(const request of [
    async()=>{throw Error(ready.CRON_SECRET);},
    async()=>new Response(ready.CRON_SECRET,{status:500}),
    async()=>Response.json({configured:false,workers:2,detail:ready.CRON_SECRET}),
  ]) await assert.rejects(configureWorkers(ready,async(url,init)=>{
    if(url.includes("/http_request_queue"))return Response.json({code:"PGRST106"},{status:406});
    return request(url,init);
  }),error=>{
    assert.equal(error.message,"QA worker configuration failed");return true;
  });
});
test("trailing slash is allowed for the exact QA Preview origin",()=>{
  assert.doesNotThrow(()=>validateWorkerEnvironment({...ready,APP_URL:QA_PREVIEW+"/"}));
});

test("an exposed network schema refuses credential provisioning",async()=>{
  let calls=0;
  await assert.rejects(configureWorkers(ready,async()=>{calls++;return Response.json([]);}),/QA worker configuration failed/);
  assert.equal(calls,1);
});
