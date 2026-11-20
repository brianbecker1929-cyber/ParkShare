import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertLocalRehearsalUrl } from '../scripts/qa-schema-rehearsal.mjs';

test('full-schema restore refuses QA/production hosts and any non-dedicated database',()=>{
  for(const raw of [
    'postgresql://postgres@db.biydlfekindgaslgktsx.supabase.co/parkshare_test',
    'postgresql://postgres@db.oyxrussraxjgqwzpwyca.supabase.co/parkshare_test',
    'postgresql://postgres@localhost/postgres',
    'postgresql://postgres@localhost/parkshare_test?host=db.example.com',
  ]) assert.throws(()=>assertLocalRehearsalUrl(raw));
  assert.doesNotThrow(()=>assertLocalRehearsalUrl('postgresql://postgres:postgres@localhost:5432/parkshare_test'));
});
