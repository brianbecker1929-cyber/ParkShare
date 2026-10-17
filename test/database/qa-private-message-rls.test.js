import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const HOST = "00000000-0000-4000-8000-000000000201";
const A = "00000000-0000-4000-8000-000000000202";
const B = "00000000-0000-4000-8000-000000000203";
const OTHER = "00000000-0000-4000-8000-000000000204";

describe("message RLS in disposable PostgreSQL", { skip: !databaseUrl, concurrency: 1 }, () => {
  let pool, listingId;
  before(async () => {
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, max: 4 });
    await pool.query(await readFile(new URL("./booking-holds-fixture.sql", import.meta.url), "utf8"));
    await pool.query([
      "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;",
      "GRANT USAGE ON SCHEMA auth,public TO authenticated,anon,service_role;",
      "CREATE TABLE public.messages(id bigint PRIMARY KEY,listing_id bigint NOT NULL REFERENCES public.listings(id),booking_id bigint,sender_id uuid NOT NULL,recipient_id uuid,text text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());",
      "ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;",
      "CREATE POLICY \"Participants can view messages on a listing they're involved in\" ON public.messages FOR SELECT USING (auth.uid()=sender_id OR auth.uid() IN (SELECT m2.sender_id FROM public.messages m2 WHERE m2.listing_id=messages.listing_id));",
      "CREATE POLICY \"Authenticated users can send messages\" ON public.messages FOR INSERT WITH CHECK(auth.uid()=sender_id);",
      "GRANT SELECT,INSERT,UPDATE,DELETE ON public.messages TO anon,authenticated;",
      "ALTER ROLE service_role BYPASSRLS;"
    ].join("\n"));
    await pool.query("INSERT INTO auth.users(id) VALUES ($1),($2),($3),($4)",[HOST,A,B,OTHER]);
    await pool.query("INSERT INTO public.profiles(id) VALUES ($1),($2),($3),($4)",[HOST,A,B,OTHER]);
    const l=await pool.query("INSERT INTO public.listings(host_id,spaces) VALUES ($1,1) RETURNING id",[HOST]);
    listingId=l.rows[0].id;
    await pool.query("INSERT INTO public.messages(id,listing_id,sender_id,recipient_id,text) VALUES (1,$1,$2,$3,'A question'),(2,$1,$3,$2,'Host replies A'),(3,$1,$4,$3,'B question'),(4,$1,$3,$4,'Host replies B')",[listingId,A,HOST,B]);
    await pool.query(await readFile(new URL("../../docs/sql-proposals/qa-private-messages-rls.sql",import.meta.url),"utf8"));
  });
  after(async()=>{ await pool?.end(); });

  async function asRole(role,userId,sql,params=[]) {
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE "+role);
      if (userId) await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[userId]);
      try {
        const result=await client.query(sql,params);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    } finally { client.release(); }
  }

  test("Driver A sees only own exchange",async()=>{
    const r=await asRole("authenticated",A,"SELECT id FROM public.messages ORDER BY id");
    assert.deepEqual(r.rows.map(x=>Number(x.id)),[1,2]);
  });
  test("Driver B cannot view Driver A conversation",async()=>{
    const r=await asRole("authenticated",B,"SELECT id FROM public.messages ORDER BY id");
    assert.deepEqual(r.rows.map(x=>Number(x.id)),[3,4]);
  });
  test("Host sees own messages with both renters",async()=>{
    const r=await asRole("authenticated",HOST,"SELECT id FROM public.messages ORDER BY id");
    assert.deepEqual(r.rows.map(x=>Number(x.id)),[1,2,3,4]);
  });
  test("unrelated authenticated user gets no messages",async()=>{
    const r=await asRole("authenticated",OTHER,"SELECT id FROM public.messages");
    assert.equal(r.rowCount,0);
  });
  test("anonymous user gets permission denied",async()=>{
    await assert.rejects(asRole("anon",null,"SELECT * FROM public.messages"),e=>e.code==="42501");
  });
  test("direct authenticated message inserts are denied",async()=>{
    await assert.rejects(asRole("authenticated",A,"INSERT INTO public.messages(id,listing_id,sender_id,recipient_id,text) VALUES (11,$1,$2,$3,'forged')",[listingId,A,OTHER]),e=>e.code==="42501");
    const r=await pool.query("SELECT COUNT(*)::int AS n FROM public.messages");
    assert.equal(r.rows[0].n,4);
  });
  test("server service_role retains insert permissions",async()=>{
    await asRole("service_role",null,"INSERT INTO public.messages(id,listing_id,sender_id,recipient_id,text) VALUES (12,$1,$2,$3,'authorized')",[listingId,A,HOST]);
    const r=await asRole("authenticated",A,"SELECT id FROM public.messages WHERE id=12");
    assert.equal(r.rowCount,1);
    await pool.query("DELETE FROM public.messages WHERE id=12");
  });
  test("replaces recursive listing-wide read policy with sender/recipient-only",async()=>{
    const r=await pool.query("SELECT policyname,qual FROM pg_policies WHERE schemaname='public' AND tablename='messages' AND cmd='SELECT'");
    assert.equal(r.rowCount,1);
    assert.match(r.rows[0].qual,/sender_id/);
    assert.match(r.rows[0].qual,/recipient_id/);
    assert.doesNotMatch(r.rows[0].qual,/SELECT .*messages/i);
  });
});
