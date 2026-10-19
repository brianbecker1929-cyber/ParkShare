// Synthetic, disposable database only; never run against managed QA/production.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export const refundLedgerMigration=new URL('../supabase/migrations/20261019181031_multiple_refund_ledger_005188.sql',import.meta.url);
export async function runRefundLedgerProbe(db,report={checks:[]}){
 await db.exec(await readFile(refundLedgerMigration,'utf8'));
 const check=name=>report.checks.push({name:'refund ledger: '+name,status:'passed'});
 await db.exec('BEGIN;');
 try{
  const host='00000000-0000-4000-8000-000000000061',driver='00000000-0000-4000-8000-000000000062';
  await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'ledger-host@example.invalid','{"name":"Synthetic Host","role":"host"}'),($2,'ledger-driver@example.invalid','{"name":"Synthetic Driver","role":"driver"}')`,[host,driver]);
  const listing=(await db.query(`INSERT INTO public.listings(host_id,title,address,price,spaces) VALUES($1,'Synthetic ledger','Toronto ON M5V 2T6',10,4) RETURNING id`,[host])).rows[0].id;
  const booking=async(account='acct_owner',pi='pi_base',ch='ch_base')=>(await db.query(`INSERT INTO public.bookings(listing_id,renter_id,hours,total,subtotal,service_fee,status,paid_at,stripe_connected_account_id,stripe_payment_intent_id,stripe_charge_id) VALUES($1,$2,1,100,85,15,'confirmed',now(),$3,$4,$5) RETURNING id`,[listing,driver,account,pi,ch])).rows[0].id;
  const id=await booking(),other=await booking('acct_other');
  const refund=(refund_id,amount_cents,status='succeeded')=>({refund_id,amount_cents,status,created:1792000000,failure_reason:status==='failed'?'declined':null});
  const first=refund('re_first',2000),second=refund('re_second',3000);
  const row=async()=> (await db.query('SELECT * FROM public.bookings WHERE id=$1',[id])).rows[0];
  const call=async({kind='booking',record=id,account='acct_owner',pi='pi_base',charge='ch_base',revision,refunds=[first],reported=2000,mode=false}={})=>{
   if(revision===undefined)revision=Number((await db.query(`SELECT refund_ledger_revision FROM public.${kind==='booking'?'bookings':'booking_extensions'} WHERE id=$1`,[record])).rows[0].refund_ledger_revision);
   return db.query('SELECT public.reconcile_payment_refunds($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,false) result',[kind,record,account,pi,charge,mode,revision,'evt_synthetic',10000,reported,JSON.stringify(refunds)]);
  };
  const denied=async(fn,code)=>{await db.exec('SAVEPOINT rejected;');await assert.rejects(fn,e=>!code||e.code===code);await db.exec('ROLLBACK TO SAVEPOINT rejected;');};
  await call();await call();
  assert.equal((await db.query('SELECT count(*)::int n FROM public.payment_refunds')).rows[0].n,1);
  assert.equal(Number((await row()).refund_total_amount),20);check('duplicate delivery records one refund and does not double count');
  await call({refunds:[second,first],reported:5000});
  let b=await row();assert.equal(b.stripe_refund_id,'re_first');assert.equal(Number(b.refund_amount),20);assert.equal(Number(b.refund_total_amount),50);assert.equal(b.status,'confirmed');
  assert.equal((await db.query('SELECT refund_total_amount FROM public.bookings WHERE id=$1',[other])).rows[0].refund_total_amount,null);
  check('second partial refund retains original reference, totals both refunds, preserves reservation and other account');
  const pending=refund('re_pending',1000,'pending');await call({refunds:[first,second,pending],reported:6000});
  b=await row();assert.equal(Number(b.refund_pending_amount),10);assert.equal(Number(b.refund_total_amount),50);check('pending money is distinct from settled money');
  const failed={...pending,status:'failed'};await call({refunds:[first,second,failed],reported:5000});
  b=await row();assert.equal(Number(b.refund_pending_amount),0);assert.equal(Number(b.refund_total_amount),50);check('failed pending refund leaves settled total unchanged');
  const revision=Number(b.refund_ledger_revision);
  await call({refunds:[first,second,failed],reported:5000});
  await denied(()=>call({revision,refunds:[first],reported:2000}),'40001');check('older concurrent snapshot is rejected under lock');
  for(const options of [
   {refunds:[first],reported:2000},
   {refunds:[{...first,amount_cents:1000},second,failed],reported:4000},
   {refunds:[first,first],reported:4000},
   {refunds:[first,second,failed,refund('re_tooMuch',6000)],reported:11000},
   {account:'acct_attacker'}, {charge:'ch_other'}, {mode:true,refunds:[first,second,failed],reported:5000},
  ])await denied(()=>call(options));
  assert.equal(Number((await row()).refund_total_amount),50);check('incomplete, duplicate, over-refunded, immutable identity, wrong account/charge/mode snapshots roll back');
  await db.query("UPDATE public.bookings SET refund_status='pending' WHERE id=$1",[id]);
  await denied(()=>call({revision:revision+1,refunds:[first,second,failed],reported:5000}),'40001');check('legacy/cancellation financial write invalidates in-flight snapshot');
  await db.query("UPDATE public.bookings SET status='disputed' WHERE id=$1",[id]);
  const rest=refund('re_rest',5000);await call({refunds:[first,second,failed,rest],reported:10000});
  assert.equal((await row()).status,'disputed');check('full refund evidence preserves dispute status');
  const full=await booking('acct_owner','pi_full','ch_full');
  await call({record:full,pi:'pi_full',charge:'ch_full',refunds:[refund('re_full',10000)],reported:10000});
  assert.equal((await db.query('SELECT status FROM public.bookings WHERE id=$1',[full])).rows[0].status,'refunded');check('fully settled refund marks only its base booking refunded');
  const extension=(await db.query(`INSERT INTO public.booking_extensions(booking_id,added_hours,added_amount,status,paid_at,stripe_connected_account_id,stripe_payment_intent_id,stripe_charge_id) VALUES($1,1,100,'paid',now(),'acct_owner','pi_extension','ch_extension') RETURNING id`,[other])).rows[0].id;
  const oldHours=(await db.query('SELECT hours,status FROM public.bookings WHERE id=$1',[other])).rows[0];
  await call({kind:'extension',record:extension,pi:'pi_extension',charge:'ch_extension',refunds:[refund('re_ext1',2000),refund('re_ext2',3000)],reported:5000});
  const e=(await db.query('SELECT * FROM public.booking_extensions WHERE id=$1',[extension])).rows[0];assert.equal(Number(e.refund_total_amount),50);assert.equal(e.status,'paid');
  assert.deepEqual((await db.query('SELECT hours,status FROM public.bookings WHERE id=$1',[other])).rows[0],oldHours);check('multiple extension refunds stay separate and preserve hours/base booking status');
  await call({kind:'extension',record:extension,pi:'pi_extension',charge:'ch_extension',refunds:[refund('re_ext1',2000),refund('re_ext2',3000),refund('re_ext3',5000)],reported:10000});
  const fullExtension=(await db.query('SELECT status,charge_fully_refunded FROM public.booking_extensions WHERE id=$1',[extension])).rows[0];
  assert.equal(fullExtension.status,'paid');assert.equal(fullExtension.charge_fully_refunded,true);
  assert.deepEqual((await db.query('SELECT hours,status FROM public.bookings WHERE id=$1',[other])).rows[0],oldHours);check('full extension refund does not revoke parking entitlement');
  for(const role of ['anon','authenticated']){
   for(const sql of ['SELECT * FROM public.payment_refunds',`SELECT public.reconcile_payment_refunds('booking',1,'acct_owner','pi_base','ch_base',false,0,'evt_synthetic',10000,0,'[]',false)`]){
    await db.exec('SAVEPOINT permissions;');await db.exec('SET LOCAL ROLE '+role);await assert.rejects(db.query(sql),e=>e.code==='42501');await db.exec('ROLLBACK TO SAVEPOINT permissions;');
   }
  }check('anonymous and signed-in clients cannot read ledger or execute reconciliation');
  await db.exec('SET LOCAL ROLE service_role;');
  assert.ok((await db.query('SELECT count(*)::int n FROM public.payment_refunds')).rows[0].n>=6);await db.exec('RESET ROLE;');check('service role retains ledger access');
 }finally{await db.exec('ROLLBACK;');}
 return report;
}
