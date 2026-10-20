// Only the disposable full-schema runner invokes this synthetic-data probe.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export const extensionSettlementMigration=new URL('../supabase/migrations/20261020205407_extension_settlement_005116_005260.sql',import.meta.url);
export async function runExtensionSettlementProbe(db,report){
 const check=name=>report.checks.push({name:'extension settlement: '+name,status:'passed'});
 await db.exec(await readFile(extensionSettlementMigration,'utf8'));
 report.migrations.push({name:'extension_settlement_005116_005260',status:'passed'});
 for(const fn of ['public.record_rejected_booking_extension(text,text,text,text,integer,timestamptz)','public.release_unpaid_extension_checkout(text,text)']){
  for(const role of ['anon','authenticated'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,fn])).rows[0].allowed,false);
 }
 check('browser roles cannot journal payments or release extension holds');
 await db.exec('BEGIN;');
 try{
  const host='00000000-0000-4000-8000-000000005261',driver='00000000-0000-4000-8000-000000005262';
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'extension-host@example.invalid','{"role":"host"}'),($2,'extension-driver@example.invalid','{"role":"driver"}')`,[host,driver]);
  const listing=(await db.query(`insert into public.listings(host_id,title,address,price,spaces,lat,lng,time_zone) values($1,'Synthetic extension','Toronto ON M5V 2T6',1,1,43.65,-79.38,'America/Toronto') returning id`,[host])).rows[0].id;
  const booking=(await db.query(`insert into public.bookings(listing_id,renter_id,hours,total,subtotal,service_fee,status,paid_at,scheduled_starts_at,property_time_zone,spot_label,stripe_connected_account_id) values($1,$2,1,1.15,1,.15,'confirmed',now()-interval '30 minutes',now()-interval '30 minutes','America/Toronto','A','acct_extension') returning id`,[listing,driver])).rows[0].id;
  const before=(await db.query('select hours,session_range from public.bookings where id=$1',[booking])).rows[0];
  await db.exec('SET LOCAL ROLE service_role;');
  const reserve=async(session)=>{
   const hold=(await db.query('select * from public.reserve_extension_checkout_hold($1,$2,1,now()+interval \'30 minutes\')',[booking,driver])).rows[0].hold_id;
   await db.query('update public.booking_holds set stripe_checkout_session_id=$2 where id=$1',[hold,session]);
   await db.query(`insert into public.pending_booking_extensions(booking_id,renter_id,added_hours,expected_total_cents,expected_service_fee_cents,expected_connected_account_id,stripe_checkout_session_id,hold_id) values($1,$2,1,115,15,'acct_extension',$3,$4)`,[booking,driver,session,hold]);return hold;
  };
  const originalHold=await reserve('cs_failed_probe');
  const journal=()=>db.query("select public.record_rejected_booking_extension('cs_failed_probe','pi_failed_probe','ch_failed_probe','acct_extension',115,now()) id");
  const id=(await journal()).rows[0].id;assert.equal((await journal()).rows[0].id,id);
  assert.deepEqual((await db.query('select hours,session_range from public.bookings where id=$1',[booking])).rows[0],before);
  assert.equal((await db.query('select count(*)::int n from public.booking_holds where id=$1',[originalHold])).rows[0].n,0);
  check('rejected financial audit and hold release commit together without changing booking');
  const application=(await db.query("select * from public.apply_paid_booking_extension('cs_failed_probe',$1,$2,1,115,'pi_failed_probe','ch_failed_probe','acct_extension',now())",[booking,driver])).rows[0];
  assert.equal(application.applied,false);check('rejected checkout replay cannot grant time');
  await db.query("select public.reconcile_payment_refunds('extension',$1,'acct_extension','pi_failed_probe','ch_failed_probe',false,0,'evt_failed_probe',115,115,$2::jsonb,false)",[id,JSON.stringify([{refund_id:'re_failed_probe',amount_cents:115,status:'succeeded',created:1792000000,failure_reason:null}])]);
  const audit=(await db.query('select application_state,refund_total_amount,charge_fully_refunded from public.booking_extensions where id=$1',[id])).rows[0];
  assert.equal(audit.application_state,'rejected');assert.equal(Number(audit.refund_total_amount),1.15);assert.equal(audit.charge_fully_refunded,true);
  check('refund ledger records rejected extension money and retains rejection marker');
  await reserve('cs_retry_probe');
  const applied=(await db.query("select * from public.apply_paid_booking_extension('cs_retry_probe',$1,$2,1,115,'pi_retry_probe','ch_retry_probe','acct_extension',now())",[booking,driver])).rows[0];
  assert.equal(applied.applied,true);assert.equal(Number(applied.resulting_hours),2);check('same additional hour can be reserved and applied after rejection');
  await reserve('cs_terminal_probe');
  assert.equal((await db.query("select public.release_unpaid_extension_checkout('cs_terminal_probe','acct_extension') released")).rows[0].released,true);
  assert.equal(Number((await db.query('select hours from public.bookings where id=$1',[booking])).rows[0].hours),2);check('unpaid terminal pair cleanup preserves applied booking hours');
 }finally{await db.exec('ROLLBACK;');}
 return report;
}
