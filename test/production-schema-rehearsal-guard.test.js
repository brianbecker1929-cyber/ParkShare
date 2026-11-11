import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assertProductionRehearsalUrl,assertProductionRehearsalServer} from '../scripts/production-schema-rehearsal.mjs';
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
test('server guard requires a fresh empty database and refuses existing Auth or application tables',()=>{
 const target={db:'parkshare_production_rehearsal',engine:'PostgreSQL 17.6',address:'127.0.0.1',existingTables:0};
 assert.doesNotThrow(()=>assertProductionRehearsalServer(target));
 for(const patch of [{existingTables:1},{db:'postgres'},{engine:'PostgreSQL 18.1'},{address:'10.0.0.2'},{address:'8.8.8.8'}])assert.throws(()=>assertProductionRehearsalServer({...target,...patch}));
});
test('Docker bridge allowance requires the explicit disposable GitHub service and still refuses a nonempty database',()=>{
 const target={db:'parkshare_production_rehearsal',engine:'PostgreSQL 17.6',address:'172.18.0.2',existingTables:0};
 const env={GITHUB_ACTIONS:'true',CI:'true',PRODUCTION_REHEARSAL_CI_SERVICE:'postgres:17.6-bookworm'};
 assert.doesNotThrow(()=>assertProductionRehearsalServer(target,env));
 for(const missing of Object.keys(env))assert.throws(()=>assertProductionRehearsalServer(target,{...env,[missing]:undefined}));
 assert.throws(()=>assertProductionRehearsalServer({...target,existingTables:45},env));
 assert.throws(()=>assertProductionRehearsalServer({...target,address:'172.32.0.1'},env));
});
