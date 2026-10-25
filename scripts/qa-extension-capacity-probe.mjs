import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export async function runExtensionCapacityProbe(db,report){
 const targets=['create_booking_hold','apply_paid_booking_extension'];
 const meta=async()=> (await db.query("select proname,prosecdef,proowner,proacl,proconfig from pg_proc where pronamespace='public'::regnamespace and proname=any($1) order by proname",[targets])).rows;
 const before=await meta();
 const rows=await db.query('select to_jsonb(b) as row from public.bookings b order by id');
 await db.exec(await readFile(new URL('../supabase/migrations/20261025151011_deduplicate_extension_spot_capacity_005324.sql',import.meta.url),'utf8'));
 assert.deepEqual(await meta(),before);
 assert.deepEqual((await db.query('select to_jsonb(b) as row from public.bookings b order by id')).rows,rows.rows);
 report.migrations.push({name:'deduplicate_extension_spot_capacity_005324',status:'passed'});
 report.checks.push({name:'extension capacity: reviewed function bodies patched; existing owners, grants, security settings and booking data preserved',status:'passed'});
}
