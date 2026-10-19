// Synthetic full-schema regression; disposable local database only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export const publicParkingMigration=new URL('../supabase/migrations/20261019192851_bounded_public_parking_005220.sql',import.meta.url);
export async function runPublicParkingProbe(db,report={checks:[]}) {
  await db.exec(await readFile(publicParkingMigration,'utf8'));
  const check=name=>report.checks.push({name:'public parking: '+name,status:'passed'});
  for(const role of ['anon','authenticated']) {
    assert.equal((await db.query("SELECT has_function_privilege($1,'public.public_parking_page(bigint)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  }
  assert.equal((await db.query("SELECT has_function_privilege('service_role','public.public_parking_page(bigint)','EXECUTE') allowed")).rows[0].allowed,true);
  check('server-only RPC grants');
  await db.exec('BEGIN;');
  try {
    const host='00000000-0000-4000-8000-000000000071';
    await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'page-host@example.invalid','{"name":"Synthetic Host","role":"host"}')`,[host]);
    await db.query(`INSERT INTO public.listings(host_id,title,address,price,spaces,img,spots,lat,lng,time_zone)
      SELECT $1,'Private title','Private address M5V 2T6',12,2,repeat('large-photo',10000),
        '[{"forRent":true,"polygon":"private geometry"},{"forRent":false}]',43.824194,-79.418116,'America/Toronto'
      FROM generate_series(1,123)`,[host]);
    const syntheticIds=new Set((await db.query('SELECT id FROM public.listings WHERE host_id=$1',[host])).rows.map(row=>String(row.id)));
    const ids=[];let cursor=null,pages=0;
    do {
      const rows=(await db.query('SELECT * FROM public.public_parking_page($1)',[cursor])).rows;
      assert.ok(rows.length<=51);const page=rows.slice(0,50);pages++;
      for(const row of page){assert.ok(cursor===null||Number(row.id)<Number(cursor));if(!syntheticIds.has(String(row.id)))continue;assert.equal(row.lat,43.82);assert.equal(row.lng,-79.42);
        assert.equal(JSON.stringify(row).includes('private geometry'),false);assert.equal(JSON.stringify(row).includes('large-photo'),false);assert.deepEqual(row.spots,[{forRent:true},{forRent:false}]);}
      ids.push(...page.map(row=>String(row.id)));
      cursor=rows.length>50?page.at(-1).id:null;
    } while(cursor);
    assert.ok(pages>=3);assert.equal(ids.length,new Set(ids).size);assert.ok(ids.length>=123);
    check('stable bounded pages omit photo blobs, addresses, identities and geometry');
    await db.exec('ROLLBACK;');
  } catch(error){await db.exec('ROLLBACK;');throw error;}
}
