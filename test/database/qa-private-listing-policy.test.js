import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const HOST = "00000000-0000-4000-8000-00000000b101";
const DRIVER = "00000000-0000-4000-8000-00000000b102";
const REVIEWER = "00000000-0000-4000-8000-00000000b103";

describe("BUG-005183 privacy RLS on disposable PostgreSQL", {skip: !databaseUrl, concurrency:1},()=>{
 let pool,listingId;
 before(async()=>{
  pool=new Pool({connectionString:databaseUrl,connectionTimeoutMillis:5000,max:3});
  await pool.query(await readFile(new URL("./booking-holds-fixture.sql",import.meta.url),"utf8"));
  const sql=[
   "ALTER TABLE public.profiles ADD COLUMN role text;",
   "ALTER TABLE public.listings ADD COLUMN address text;",
   "ALTER TABLE public.listings ADD COLUMN lat double precision;",
   "ALTER TABLE public.listings ADD COLUMN lng double precision;",
   "CREATE TABLE public.reviews(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,listing_id bigint,user_id uuid,rating integer,text text);",
   "CREATE SCHEMA storage;",
   "CREATE TABLE storage.buckets(id text primary key,public boolean);",
   "INSERT INTO storage.buckets(id,public) VALUES ('listing-photos',true);",
   "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;",
   "ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;",
   "ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;",
   "ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;",
   'CREATE POLICY "Listings are viewable by everyone" ON public.listings FOR SELECT USING (true);',
   'CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);',
   'CREATE POLICY "Reviews are viewable by everyone" ON public.reviews FOR SELECT USING (true);',
   "GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;",
   "GRANT SELECT ON public.listings,public.profiles,public.reviews TO anon,authenticated;",
   "INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-00000000b101'),('00000000-0000-4000-8000-00000000b102'),('00000000-0000-4000-8000-00000000b103');",
   "INSERT INTO public.profiles(id,role) VALUES ('00000000-0000-4000-8000-00000000b101','host'),('00000000-0000-4000-8000-00000000b102','driver'),('00000000-0000-4000-8000-00000000b103','driver');",
  ].join("\n");
  await pool.query(sql);
  const l=await pool.query("INSERT INTO public.listings(host_id,address,lat,lng) VALUES ($1,'123 Private Lane',43.861238,-79.433455) RETURNING id",[HOST]);
  listingId=l.rows[0].id;
  await pool.query("INSERT INTO public.reviews(listing_id,user_id,rating,text) VALUES ($1,$2,5,'Great spot')",[listingId,REVIEWER]);
  await pool.query(await readFile(new URL("../../docs/sql-proposals/bug-005183-restrict-public-data-api.sql",import.meta.url),"utf8"));
 });
 after(async()=>{await pool?.end()});
 async function asRole(role,userId,statement,params=[]){
  const client=await pool.connect();
  try{
   await client.query("BEGIN");
   await client.query("SET LOCAL ROLE "+role);
   if(userId)await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[userId]);
   try{
    const result=await client.query(statement,params);
    await client.query("COMMIT");
    return result;
   }catch(e){await client.query("ROLLBACK");throw e;}
  }finally{client.release();}
 }
 test("anonymous exact listings, profiles and reviews are inaccessible",async()=>{
  for(const table of ["listings","profiles","reviews"]){
   await assert.rejects(asRole("anon",null,"SELECT * FROM public."+table),e=>e.code==="42501");
  }
 });
 test("unbooked Driver has no raw listings or other user profiles",async()=>{
  const listings=await asRole("authenticated",DRIVER,"SELECT id,address,lat,lng,host_id FROM public.listings");
  assert.equal(listings.rowCount,0);
  const profiles=await asRole("authenticated",DRIVER,"SELECT id FROM public.profiles");
  assert.deepEqual(profiles.rows,[{id:DRIVER}]);
 });
 test("Host can read own listing and own profile",async()=>{
  const listing=await asRole("authenticated",HOST,"SELECT id,address FROM public.listings");
  assert.deepEqual(listing.rows,[{id:listingId,address:"123 Private Lane"}]);
  const profiles=await asRole("authenticated",HOST,"SELECT id FROM public.profiles");
  assert.deepEqual(profiles.rows,[{id:HOST}]);
 });
 test("reviewer can read own review but another Driver cannot",async()=>{
  const review=await asRole("authenticated",REVIEWER,"SELECT id,user_id,rating FROM public.reviews");
  assert.equal(review.rowCount,1);
  const other=await asRole("authenticated",DRIVER,"SELECT id,user_id,rating FROM public.reviews");
  assert.equal(other.rowCount,0);
 });
 test("listing photo bucket is no longer public",async()=>{
  const r=await pool.query("SELECT public FROM storage.buckets WHERE id='listing-photos'");
  assert.equal(r.rows[0].public,false);
 });
});
