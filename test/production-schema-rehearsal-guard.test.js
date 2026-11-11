import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertProductionRehearsalUrl} from '../scripts/production-schema-rehearsal.mjs';
test('production schema rehearsal refuses hosted targets and URL connection overrides before connecting',()=>{
 const rejected=[
  'postgresql://postgres@db.oyxrussraxjgqwzpwyca.supabase.co/parkshare_production_rehearsal',
  'postgresql://postgres@db.heqxirlsorcztsawaldg.supabase.co/parkshare_production_rehearsal',
  'postgresql://postgres@localhost/postgres',
  'postgresql://postgres@localhost/parkshare_test',
  'postgresql://postgres@localhost/parkshare_production_rehearsal?host=db.example.com',
  'postgresql://postgres@localhost/parkshare_production_rehearsal#override',
  'https://postgres@localhost/parkshare_production_rehearsal',
  'postgresql://service_role@localhost/parkshare_production_rehearsal'
 ];
 for(const url of rejected)assert.throws(()=>assertProductionRehearsalUrl(url));
 assert.deepEqual(assertProductionRehearsalUrl('postgresql://postgres@127.0.0.1:55439/parkshare_production_rehearsal'),{host:'127.0.0.1',port:55439,database:'parkshare_production_rehearsal',user:'postgres',password:'',ssl:false,options:'',connectionTimeoutMillis:5000});
});
