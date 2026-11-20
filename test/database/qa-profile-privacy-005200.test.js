import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {after,before,describe,test} from 'node:test';
import pg from 'pg';
import {assertLocalRehearsalUrl} from '../../scripts/qa-schema-rehearsal.mjs';
import {profilePrivacyChecks} from '../../scripts/qa-profile-privacy-probes.mjs';

const databaseUrl=process.env.TEST_DATABASE_URL;
const ids={host:'00000000-0000-4000-8000-000000002001',
  driver:'00000000-0000-4000-8000-000000002002',
  other:'00000000-0000-4000-8000-000000002003'};

describe('BUG-005200 profile privacy on disposable PostgreSQL', {skip:!databaseUrl,concurrency:1},()=>{
  let client;
  const db={query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql)};
  before(async()=>{
    assertLocalRehearsalUrl(databaseUrl); // Reject hosted/production before any DDL.
    client=new pg.Client({connectionString:databaseUrl,connectionTimeoutMillis:5000});
    await client.connect();
    await db.exec(await readFile(new URL('./booking-holds-fixture.sql',import.meta.url),'utf8'));
    await db.exec(`
      ALTER ROLE service_role BYPASSRLS;
      ALTER TABLE public.profiles ADD COLUMN name text, ADD COLUMN role text,
        ADD COLUMN email text, ADD COLUMN stripe_account_id text;
      CREATE TABLE public.reviews(id bigint,user_id uuid);
      DROP SCHEMA IF EXISTS storage CASCADE;
      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets(id text primary key,public boolean);
      INSERT INTO storage.buckets VALUES('listing-photos',true);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
      ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING(true);
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      GRANT SELECT (id,name,role) ON public.profiles TO anon,authenticated;
      GRANT ALL ON public.profiles TO service_role;
    `);
    for(const [id,role] of [[ids.host,'host'],[ids.driver,'driver'],[ids.other,'driver']]) {
      await db.query('INSERT INTO auth.users(id) VALUES($1)',[id]);
      await db.query('INSERT INTO public.profiles(id,name,role,email,stripe_account_id) VALUES($1,$2,$3,$4,$5)',
        [id,'Synthetic '+role,role,id+'@example.invalid','acct_synthetic_'+id.slice(-4)]);
    }
    // Reproduce the reported ACL/policy combination without reading QA users.
    const before=await db.query("BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','"+ids.driver+"',true); SELECT id,name,role FROM public.profiles;");
    assert.equal(before.at(-1).rows.length,3);
    await db.exec('ROLLBACK;');
    await db.exec(await readFile(new URL('../../docs/sql-proposals/bug-005183-restrict-public-data-api.sql',import.meta.url),'utf8'));
  });
  after(async()=>{await client?.end();});
  for(const [name,run] of profilePrivacyChecks(db,ids)) test(name,run);
});
