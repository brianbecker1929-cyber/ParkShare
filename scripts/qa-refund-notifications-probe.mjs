import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export async function runRefundNotificationsProbe(db,report={checks:[]}) {
  const check=name=>report.checks.push({name:'refund notifications: '+name,status:'passed'});
  const digest=async()=> (await db.query("select md5(coalesce(string_agg(to_jsonb(b)::text,'|' order by id),'')) digest from public.bookings b")).rows[0].digest;
  const before=await digest();
  await db.exec(await readFile(new URL('../supabase/migrations/20261021111213_refund_notifications_005249.sql',import.meta.url),'utf8'));
  assert.equal(await digest(),before);
  assert.equal((await db.query('select count(*)::int n from public.refund_email_deliveries')).rows[0].n,0);
  check('migration changes no booking or historical refund and queues no historical emails');
  for (const role of ['anon','authenticated']) {
    assert.equal((await db.query("select has_table_privilege($1,'public.refund_email_deliveries','select') allowed",[role])).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege($1,'parkshare_private.queue_refund_emails()','execute') allowed",[role])).rows[0].allowed,false);
  }
  check('browser roles cannot inspect receipts or queue messages');
  await db.exec('begin');
  try {
    const host='00000000-0000-4000-8000-000000005249',driver='00000000-0000-4000-8000-000000005248';
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'refund-host@example.invalid','{"role":"host"}'),($2,'refund-driver@example.invalid','{"role":"driver"}')`,[host,driver]);
    await db.query(`insert into public.profiles(id,name,email,role) values($1,'Synthetic Host','refund-host@example.invalid','host'),($2,'Synthetic Driver','refund-driver@example.invalid','driver') on conflict(id) do nothing`,[host,driver]);
    const listing=(await db.query(`insert into public.listings(host_id,title,address,price,spaces,lat,lng,time_zone) values($1,'Synthetic refund','Toronto ON M5V 2T6',10,1,43.65,-79.38,'America/Toronto') returning id`,[host])).rows[0].id;
    const booking=(await db.query(`insert into public.bookings(listing_id,renter_id,hours,total,status,paid_at,session_range,spot_label,stripe_connected_account_id,stripe_payment_intent_id,stripe_charge_id) values($1,$2,1,100,'confirmed',now()-interval '30 minutes',tstzrange(now()-interval '30 minutes',now()+interval '30 minutes','[)'),'A','acct_notify','pi_notify','ch_notify') returning id`,[listing,driver])).rows[0].id;
    const entry=(id,amount,status='succeeded',created=Math.floor(Date.now()/1000))=>({refund_id:id,amount_cents:amount,status,created});
    const r1=entry('re_notify1',2000),r2=entry('re_notify2',3000),pending=entry('re_notify3',1000,'pending');
    const size=async()=>(await db.query('select count(*)::int n from public.refund_email_deliveries')).rows[0].n;
    const call=async(refunds,reported,kind='booking',id=booking)=>{
      const revision=Number((await db.query(`select refund_ledger_revision from public.${kind==='booking'?'bookings':'booking_extensions'} where id=$1`,[id])).rows[0].refund_ledger_revision);
      return db.query(`select public.reconcile_payment_refunds($1,$2,'acct_notify',$3,$4,false,$5,'evt_notify',10000,$6,$7::jsonb,false)`,[kind,id,kind==='booking'?'pi_notify':'pi_notify_ext',kind==='booking'?'ch_notify':'ch_notify_ext',revision,reported,JSON.stringify(refunds)]);
    };
    await call([r1],2000);assert.equal(await size(),2);
    const audiences=(await db.query('select audience,booking_id from public.refund_email_deliveries order by audience')).rows;
    assert.deepEqual(audiences.map(r=>r.audience),['driver','host']);assert.ok(audiences.every(r=>String(r.booking_id)===String(booking)));
    check('verified successful partial refund commits one Driver and one Host job');
    await call([r1],2000);assert.equal(await size(),2);
    await call([r1,r2],5000);assert.equal(await size(),4);
    check('duplicate events deduplicate while a second refund gets its own two receipts');
    await call([r1,r2,pending],6000);assert.equal(await size(),4);
    await call([r1,r2,{...pending,status:'succeeded'}],6000);assert.equal(await size(),6);
    const failed=entry('re_notify_failed',1000,'failed');
    await call([r1,r2,{...pending,status:'succeeded'},failed],6000);assert.equal(await size(),6);
    check('pending and failed refunds do not claim success; transition to succeeded queues receipts');
    await db.exec('savepoint notification_rollback');
    await call([r1,r2,{...pending,status:'succeeded'},failed,entry('re_notify_last',4000)],10000);
    assert.equal(await size(),8);
    assert.equal((await db.query('select status from public.bookings where id=$1',[booking])).rows[0].status,'refunded');
    await db.exec('rollback to savepoint notification_rollback');assert.equal(await size(),6);
    check('full cancellation and receipts commit together; rolling back refund transaction removes both');
    const extension=(await db.query(`insert into public.booking_extensions(booking_id,added_hours,added_amount,status,paid_at,stripe_connected_account_id,stripe_payment_intent_id,stripe_charge_id) values($1,1,100,'paid',now(),'acct_notify','pi_notify_ext','ch_notify_ext') returning id`,[booking])).rows[0].id;
    await call([entry('re_notify_ext',10000)],10000,'extension',extension);assert.equal(await size(),8);
    assert.equal((await db.query("select count(*)::int n from public.refund_email_deliveries where refund_id='re_notify_ext' and booking_id=$1",[booking])).rows[0].n,2);
    check('extension refund resolves the correct parent booking and queues both recipients');
    const historical=entry('re_notify_historical',1000,'succeeded',1000000000);
    await db.query(`insert into public.payment_refunds(connected_account_id,livemode,refund_id,booking_id,payment_intent_id,charge_id,currency,amount_cents,status,stripe_created_at,source_event_id) values('acct_historical',false,$1,$2,'pi_old','ch_old','cad',1000,'succeeded',to_timestamp($3),'evt_old')`,[historical.refund_id,booking,historical.created]);
    assert.equal(await size(),8);check('newly discovered historical success is suppressed');
    await db.query(`insert into public.payment_refunds(connected_account_id,livemode,refund_id,booking_id,payment_intent_id,charge_id,currency,amount_cents,status,stripe_created_at,source_event_id) values('acct_historical',false,'re_old_pending',$1,'pi_old_pending','ch_old_pending','cad',1000,'pending',to_timestamp(1000000000),'evt_old_pending')`,[booking]);
    await db.exec("update public.payment_refunds set status='succeeded' where refund_id='re_old_pending'");
    assert.equal(await size(),10);check('known old pending refund notifies only when it newly succeeds');
    const id=(await db.query('select id from public.refund_email_deliveries order by created_at,id limit 1')).rows[0].id;
    const claim=()=>db.query(`update public.refund_email_deliveries set lease_until=now()+interval '2 minutes' where id=$1 and sent_at is null and blocked_at is null and lease_until<=now() returning id`,[id]);
    assert.equal((await claim()).rowCount,1);assert.equal((await claim()).rowCount,0);
    await db.query("update public.refund_email_deliveries set payload='{}',first_attempt_at=now(),provider_id='email_test',sent_at=now(),lease_until=now()-interval '1 second' where id=$1",[id]);
    assert.equal((await claim()).rowCount,0);check('conditional lease excludes active and already accepted deliveries');
  } finally { await db.exec('rollback'); }
  report.migrations??=[];report.migrations.push({name:'refund_notifications_005249',status:'passed'});
  return report;
}
