// Synthetic, disposable database only; invoked after the captured schema restore.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export const initialBookingMigration=new URL('../supabase/migrations/20261021210715_initial_booking_refund_history.sql',import.meta.url);
export const HOST='00000000-0000-4000-8000-000000005271',DRIVER='00000000-0000-4000-8000-000000005272';
export async function seedInitialBooking(db){
 await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'initial-host@example.invalid','{"role":"host"}'),($2,'initial-driver@example.invalid','{"role":"driver"}')`,[HOST,DRIVER]);
 const listing=(await db.query(`insert into public.listings(host_id,title,address,price,spaces,lat,lng,time_zone) values($1,'Synthetic checkout','Toronto ON M5V 2T6',10,2,43.65,-79.38,'America/Toronto') returning id`,[HOST])).rows[0].id;
 return {listing};
}
export async function registerInitial(db,listing,session,{spot='A',hours=1,offset=0}={}){
 const row=(await db.query(`select now()+($1::text||' hours')::interval starts`,[offset])).rows[0];
 const start=new Date(row.starts),end=new Date(start.getTime()+hours*3600000);
 const hold=(await db.query(`select public.create_booking_hold($1,$2,$3,$4,$5,now()+interval '30 minutes') id`,[listing,DRIVER,spot,start,end])).rows[0].id;
 const metadata={hold_id:hold,listing_id:String(listing),renter_id:DRIVER,host_id:HOST,connected_account_id:'acct_initial',hours:String(hours),total_cents:'1150',subtotal_cents:'1000',service_fee_cents:'150',spot_label:spot||''};
 await db.query(`update public.booking_holds set stripe_checkout_session_id=$2,expected_connected_account_id='acct_initial',expected_total_cents=1150,checkout_metadata=$3 where id=$1`,[hold,session,metadata]);
 return {hold,booking:{listing_id:Number(listing),renter_id:DRIVER,hours,total:11.5,subtotal:10,service_fee:1.5,status:'confirmed',stripe_checkout_session_id:session,stripe_payment_intent_id:'pi_'+session,stripe_charge_id:'ch_'+session,stripe_connected_account_id:'acct_initial',spot_label:spot,paid_at:start.toISOString(),property_time_zone:'America/Toronto'}};
}
export const settleInitial=(db,registration,reversed=false)=>db.query('select public.settle_initial_booking_checkout($1,$2::jsonb,$3) result',[registration.hold,JSON.stringify(registration.booking),reversed]);
export async function runInitialBookingRefundProbe(db,report){
 const check=name=>report.checks.push({name:'initial booking refund: '+name,status:'passed'});
 await db.exec(await readFile(initialBookingMigration,'utf8'));report.migrations.push({name:'initial_booking_refund_history',status:'passed'});
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.settle_initial_booking_checkout(uuid,jsonb,boolean)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 check('browser roles cannot settle or reject Checkout payments');
 await db.exec('BEGIN;');
 try{
  const {listing}=await seedInitialBooking(db);
  await db.exec('SET LOCAL ROLE service_role;');
  const registration=await registerInitial(db,listing,'cs_conflict_probe');
  const other=(await db.query(`insert into public.bookings(listing_id,renter_id,hours,total,status,spot_label,paid_at,property_time_zone,stripe_connected_account_id) values($1,$2,1,10,'confirmed','A',$3,'America/Toronto','acct_other') returning id`,[listing,DRIVER,registration.booking.paid_at])).rows[0].id;
  const first=(await settleInitial(db,registration)).rows[0].result;
  assert.equal(first.applied,false);assert.equal(first.refund_required,true);assert.equal(first.booking.application_state,'rejected');assert.equal(first.booking.status,'payment_failed');
  assert.equal(first.booking.checkout_rejection_reason,'booking_conflict');assert.equal(Number(first.booking.total),11.5);
  assert.equal((await db.query('select count(*)::int n from public.booking_holds where id=$1',[registration.hold])).rows[0].n,0);
  assert.equal((await db.query('select status from public.bookings where id=$1',[other])).rows[0].status,'confirmed');
  check('spot conflict records failed payment and releases own hold without changing other reservation');
  const again=(await settleInitial(db,registration)).rows[0].result;assert.equal(again.booking.id,first.booking.id);assert.equal(again.refund_required,true);
  check('replay resumes the same rejected payment after hold consumption');
  const history=[{refund_id:'re_initial_probe',amount_cents:1150,status:'pending',created:1792500000,failure_reason:null}];
  const reconcile=()=>db.query("select public.reconcile_payment_refunds('booking',$1,'acct_initial',$2,$3,false,$4,'evt_initial_probe',1150,1150,$5::jsonb,false)",[first.booking.id,registration.booking.stripe_payment_intent_id,registration.booking.stripe_charge_id,revision,JSON.stringify(history)]);
  let revision=0;await reconcile();
  let audit=(await db.query('select application_state,status,refund_total_amount,refund_pending_amount,refund_ledger_revision from public.bookings where id=$1',[first.booking.id])).rows[0];
  assert.equal(Number(audit.refund_total_amount),0);assert.equal(Number(audit.refund_pending_amount),11.5);assert.equal(audit.status,'payment_failed');
  check('pending refund remains distinct from returned money and grants no booking');
  revision=Number(audit.refund_ledger_revision);history[0].status='succeeded';await reconcile();
  audit=(await db.query('select application_state,status,refund_total_amount,refund_pending_amount from public.bookings where id=$1',[first.booking.id])).rows[0];
  assert.equal(audit.application_state,'rejected');assert.equal(audit.status,'refunded');assert.equal(Number(audit.refund_total_amount),11.5);assert.equal(Number(audit.refund_pending_amount),0);
  check('successful refund persists exact history without changing rejection marker');
  const valid=await registerInitial(db,listing,'cs_valid_probe',{spot:'B'});
  const applied=(await settleInitial(db,valid)).rows[0].result;assert.equal(applied.applied,true);assert.equal(applied.refund_required,false);assert.equal(applied.booking.status,'confirmed');
  assert.equal((await settleInitial(db,valid)).rows[0].result.applied,false);check('valid booking confirms once and replays without requesting refund');
  const reversed=await registerInitial(db,listing,'cs_reversed_probe',{spot:'A',offset:2});
  const noTime=(await settleInitial(db,reversed,true)).rows[0].result;assert.equal(noTime.applied,false);assert.equal(noTime.booking.checkout_rejection_reason,'payment_reversed');check('already reversed payment cannot grant parking');
 }finally{await db.exec('ROLLBACK;');}
}
