import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const HOST="00000000-0000-4000-8000-000000000201";
const DRIVER_A="00000000-0000-4000-8000-000000000202";
const DRIVER_B="00000000-0000-4000-8000-000000000203";
const makeResponse=()=>({
  code:200,body:null,
  status(n){this.code=n;return this},
  json(data){this.body=data;return this}
});

test("Host reply API denies arbitrary recipients and requires prior incoming conversation",async()=>{
  const env={
    STRIPE_SECRET_KEY:"sk_test_dummy",SUPABASE_URL:"https://mock.invalid",
    SUPABASE_ANON_KEY:"fake-anon",SUPABASE_SERVICE_ROLE_KEY:"fake-service"
  };
  const saved=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
  Object.assign(process.env,env);
  const previousFetch=globalThis.fetch;
  let hasIncoming=false,listingId=7;
  const writes=[];
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(input instanceof Request?input.url:input);
    assert.equal(url.hostname,"mock.invalid");
    const method=init.method||"GET";
    if(url.pathname==="/auth/v1/user")return Response.json({id:HOST});
    if(url.pathname==="/rest/v1/listings")return Response.json({id:listingId,host_id:HOST,title:"Private parking"});
    if(url.pathname==="/rest/v1/messages"){
      if(method==="POST"){
        const body=JSON.parse(init.body);
        writes.push(body);
        return Response.json({id:55,...body,created_at:"2026-10-17T00:00:00Z"});
      }
      const params=url.searchParams;
      return Response.json(hasIncoming && params.get("sender_id")==="eq."+DRIVER_A
        && params.get("recipient_id")==="eq."+HOST
        && params.get("listing_id")==="eq.7" ? [{id:1}] : []);
    }
    assert.fail("Unexpected endpoint "+url.pathname);
  };
  try{
    const {default:handler}=await import("../api/messages.js");
    async function send(participantId,listing=7){
      listingId=listing;
      const res=makeResponse();
      await handler({
        method:"POST",url:"/api/messages",
        headers:{authorization:"Bearer sample-token"},
        body:{listingId:listing,participantId,text:"Can I help?"}
      },res);
      return res;
    }
    let r=await send(DRIVER_B);
    assert.equal(r.code,403);
    assert.equal(writes.length,0);
    r=await send(DRIVER_A);
    assert.equal(r.code,403);
    hasIncoming=true;
    r=await send(DRIVER_A);
    assert.equal(r.code,201);
    assert.equal(writes.length,1);
    assert.equal(writes[0].sender_id,HOST);
    assert.equal(writes[0].recipient_id,DRIVER_A);
    r=await send(DRIVER_A,8);
    assert.equal(r.code,403);
    assert.equal(writes.length,1);
    assert.equal((await send("forged-uuid")).code,400);
    assert.equal((await send(HOST)).code,400);
  }finally{
    globalThis.fetch=previousFetch;
    for(const [key,val] of Object.entries(saved)){
      if(val===undefined)delete process.env[key];else process.env[key]=val;
    }
  }
});

test("SQL proposal removes listing-wide access and direct client writes",async()=>{
  const sql=await readFile(new URL("../docs/sql-proposals/qa-private-messages-rls.sql",import.meta.url),"utf8");
  assert.match(sql,/DROP POLICY IF EXISTS "Participants can view messages on a listing they're involved in"/);
  assert.match(sql,/sender_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(sql,/recipient_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(sql,/REVOKE ALL PRIVILEGES ON TABLE public\.messages FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.messages TO service_role/);
});

test("server reads continue to restrict messages to verified participants",async()=>{
  const api=await readFile(new URL("../api/messages.js",import.meta.url),"utf8");
  assert.match(api,/requireUser\(req, res\)/);
  assert.match(api,/sender_id\.eq\./);
  assert.match(api,/recipient_id\.eq\./);
  assert.match(api,/\.eq\("sender_id", participantId\)/);
  assert.match(api,/\.eq\("recipient_id", user\.id\)/);
  assert.match(api,/\.eq\("listing_id", listingId\)/);
});
