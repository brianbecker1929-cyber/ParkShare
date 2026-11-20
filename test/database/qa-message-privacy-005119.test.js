import {readFile} from 'node:fs/promises';
import {after,before,describe,test} from 'node:test';
import pg from 'pg';
import {assertLocalRehearsalUrl} from '../../scripts/qa-schema-rehearsal.mjs';
import {seedMessagePrivacyRows,messagePrivacyChecks} from '../../scripts/qa-message-privacy-probes.mjs';
const databaseUrl=process.env.TEST_DATABASE_URL;
describe('BUG-005119 private messages on disposable PostgreSQL',{skip:!databaseUrl,concurrency:1},()=>{
  let client;
  const people={host:'00000000-0000-4000-8000-000000001191',driver:'00000000-0000-4000-8000-000000001192',other:'00000000-0000-4000-8000-000000001193'};
  const context={...people};
  const db={query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql)};
  before(async()=>{
    assertLocalRehearsalUrl(databaseUrl);
    client=new pg.Client({connectionString:databaseUrl,connectionTimeoutMillis:5000});await client.connect();
    await db.exec(await readFile(new URL('./booking-holds-fixture.sql',import.meta.url),'utf8'));
    await db.exec(`
      ALTER ROLE service_role BYPASSRLS;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $fn$;
      CREATE TABLE public.messages(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,listing_id bigint NOT NULL REFERENCES public.listings(id),sender_id uuid NOT NULL REFERENCES public.profiles(id),recipient_id uuid REFERENCES public.profiles(id),text text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
      ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Participants can view messages on a listing they're involved in" ON public.messages FOR SELECT USING(true);
      CREATE POLICY "Authenticated users can send messages" ON public.messages FOR INSERT WITH CHECK(auth.uid()=sender_id);
      GRANT ALL ON public.messages TO anon,authenticated,service_role;
    `);
    for(const id of Object.values(people)) {
      await db.query('INSERT INTO auth.users(id) VALUES($1)',[id]);
      await db.query('INSERT INTO public.profiles(id) VALUES($1)',[id]);
    }
    context.listing=(await db.query('INSERT INTO public.listings(host_id) VALUES($1) RETURNING id',[people.host])).rows[0].id;
    context.ids=await seedMessagePrivacyRows(db,context);
    await db.exec(await readFile(new URL('../../docs/sql-proposals/qa-private-messages-rls.sql',import.meta.url),'utf8'));
  });
  after(async()=>{await client?.end();});
  // Read context at execution time, after synthetic identities/listing are seeded.
  const names=messagePrivacyChecks(db,{...people,ids:[]}).map(([name])=>name);
  for(const [i,name] of names.entries()) test(name,async()=>{
    await messagePrivacyChecks(db,context)[i][1]();
  });
});
