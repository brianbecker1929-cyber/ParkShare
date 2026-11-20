// Run only after restoring the disposable full-schema test database.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export const bookingFieldsMigration = new URL('../supabase/migrations/20261101225651_qa_booking_vehicle_type_005157.sql', import.meta.url);
export async function runBookingFieldsProbe(db, report = {checks:[],migrations:[]}) {
  const check = name => report.checks.push({name:'booking fields: '+name,status:'passed'});
  const history = async () => (await db.query("select md5(coalesce(string_agg(to_jsonb(b)::text,'|' order by id),'')) digest from public.bookings b")).rows[0].digest;
  const before = await history(), sql = await readFile(bookingFieldsMigration,'utf8');
  await db.exec(sql);await db.exec(sql);
  assert.equal(await history(),before);check('repeatable migration preserves every booking field and historical timestamp');
  report.migrations ??= [];report.migrations.push({name:'qa_booking_vehicle_type_005157',status:'passed'});
  await db.exec('begin;');
  try {
    const host='00000000-0000-4000-8000-00000000b157',driver='00000000-0000-4000-8000-00000000d157';
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'type-host@example.invalid','{"role":"host"}'),($2,'type-driver@example.invalid','{"role":"driver"}')`,[host,driver]);
    const listing=(await db.query("insert into public.listings(host_id,title,address,price,spaces) values($1,'Synthetic body type','Toronto ON M5V 2T6',10,1) returning id",[host])).rows[0].id;
    const id=(await db.query("insert into public.bookings(listing_id,renter_id,status,hours,total,vehicle_profile_id,vehicle_type,paid_at) values($1,$2,'pending',1,11.5,'guest-fixture','guest',now()) returning id",[listing,driver])).rows[0].id;
    for(const type of ['sedan','suv','coupe','hatchback','pickup','van',null,'primary','guest']) {
      const row=(await db.query('update public.bookings set vehicle_type=$1 where id=$2 returning vehicle_type,vehicle_profile_id',[type,id])).rows[0];
      assert.equal(row.vehicle_type,type);assert.equal(row.vehicle_profile_id,'guest-fixture');
    }
    check('six body classes and unspecified type save independently of vehicle profile ID; legacy rows remain valid');
    await db.exec('savepoint invalid_type;');
    await assert.rejects(()=>db.query("update public.bookings set vehicle_type='hovercraft' where id=$1",[id]),e=>e.code==='23514');
    await db.exec('rollback to savepoint invalid_type;');check('unknown body class fails the database constraint');
    assert.equal((await db.query('select confirmation_email_sent_at from public.bookings where id=$1',[id])).rows[0].confirmation_email_sent_at,null);
    check('new booking has no invented email acceptance timestamp');
  } finally {await db.exec('rollback;');}
}
