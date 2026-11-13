import test from 'node:test';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {assertLocalRehearsalUrl} from '../../scripts/qa-schema-rehearsal.mjs';
import {runPaymentAlertProbe} from '../../scripts/payment-alert-outbox-probe.mjs';

const url=process.env.TEST_DATABASE_URL;
test('durable operational alerts isolate access, lease claims and bounded retries',{skip:!url},async()=>{
  assertLocalRehearsalUrl(url);
  const client=new pg.Client({connectionString:url});await client.connect();
  try {
    await client.query(await readFile(new URL('./booking-holds-fixture.sql',import.meta.url),'utf8'));
    await runPaymentAlertProbe({query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql)},
      {checks:[],migrations:[]},async()=>{const peer=new pg.Client({connectionString:url});await peer.connect();return peer;});
  } finally {await client.end();}
});
