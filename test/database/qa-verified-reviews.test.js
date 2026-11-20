import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, after, describe, test } from "node:test";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const DRIVER_A = "00000000-0000-4000-8000-0000000000c1";
const DRIVER_B = "00000000-0000-4000-8000-0000000000c2";
const HOST = "00000000-0000-4000-8000-0000000000c3";

describe("verified reviews SQL in disposable PostgreSQL", {skip: !databaseUrl, concurrency: 1},()=>{
 let pool, listingId;
 before(async()=>{
  pool=new Pool({connectionString:databaseUrl,connectionTimeoutMillis:5000,max:4});
  await pool.query(await readFile(new URL("./booking-holds-fixture.sql",import.meta.url),"utf8"));
  await pool.query([
   "CREATE TABLE public.reviews(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,listing_id bigint NOT NULL REFERENCES public.listings(id),user_id uuid NOT NULL REFERENCES public.profiles(id),rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5),text text NOT NULL);",
   "ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;",
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;",
   "CREATE POLICY \"Authenticated users can leave reviews\" ON public.reviews FOR INSERT WITH CHECK(auth.uid()=user_id);",
   "GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;",
   "GRANT SELECT,INSERT ON public.reviews TO authenticated,anon,service_role;"
  ].join("\n"));
  await pool.query("INSERT INTO auth.users(id) VALUES ($1),($2),($3)",[DRIVER_A,DRIVER_B,HOST]);
  await pool.query("INSERT INTO public.profiles(id) VALUES ($1),($2),($3)",[DRIVER_A,DRIVER_B,HOST]);
  const row=await pool.query("INSERT INTO public.listings(host_id,spaces) VALUES ($1,1) RETURNING id",[HOST]);
  listingId=row.rows[0].id;
  await pool.query("INSERT INTO public.reviews(listing_id,user_id,rating,text) VALUES ($1,$2,5,'Original review')",[listingId,DRIVER_A]);
  await pool.query(await readFile(new URL("../../docs/sql-proposals/qa-verified-reviews.sql",import.meta.url),"utf8"));
 });
 after(async()=>{await pool?.end();});

 test("existing review remains intact after applying proposed unique index",async()=>{
  const r=await pool.query("SELECT user_id,rating FROM public.reviews WHERE listing_id=$1",[listingId]);
  assert.deepEqual(r.rows,[{user_id:DRIVER_A,rating:5}]);
 });

 test("duplicate Driver/listing review fails with unique violation, never overwrites",async()=>{
  await assert.rejects(pool.query(
   "INSERT INTO public.reviews(listing_id,user_id,rating,text) VALUES ($1,$2,1,'Repeat')",
   [listingId,DRIVER_A]),err=>err.code==="23505");
  const r=await pool.query("SELECT count(*)::int AS n FROM public.reviews WHERE listing_id=$1 AND user_id=$2",
   [listingId,DRIVER_A]);
  assert.equal(r.rows[0].n,1);
 });

 test("different verified Driver may submit their own independent review",async()=>{
  const r=await pool.query(
   "INSERT INTO public.reviews(listing_id,user_id,rating,text) VALUES ($1,$2,4,'Driver B') RETURNING id",
   [listingId,DRIVER_B]);
  assert.equal(r.rowCount,1);
 });

 test("browser authenticated and anon direct INSERT permissions revoked",async()=>{
  const query="SELECT has_table_privilege($1,'public.reviews','INSERT') AS granted";
  for(const role of ["anon","authenticated"]){
   const r=await pool.query(query,[role]);
   assert.equal(r.rows[0].granted,false);
  }
  const r=await pool.query(query,["service_role"]);
  assert.equal(r.rows[0].granted,true);
 });

 test("service-role server writes still permitted",async()=>{
  const r=await pool.query(
   "SELECT has_table_privilege('service_role','public.reviews','INSERT') AS granted");
  assert.equal(r.rows[0].granted,true);
 });
});
