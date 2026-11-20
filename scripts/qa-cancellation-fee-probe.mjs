// Disposable schema rehearsal ONLY; callers must validate local database scope.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export async function runCancellationFeeProbe(db,report={checks:[]},{installMigration=true}={}) {
  if(installMigration)await db.exec(await readFile(new URL('../supabase/migrations/20261111033631_cancellation_reason_fee_policy.sql',import.meta.url),'utf8'));
  const check=name=>report.checks.push({name:'cancellation fee: '+name,status:'passed'});
  report.migrations??=[];if(installMigration)report.migrations.push({name:'cancellation_reason_fee_policy',status:'passed'});
  await db.exec('begin');
  try {
    const host='00000000-0000-4000-8000-00000000f601',driver='00000000-0000-4000-8000-00000000f602';
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'refund-host@example.invalid','{"role":"host"}'),($2,'refund-driver@example.invalid','{"role":"driver"}')`,[host,driver]);
    const listing=(await db.query(`insert into public.listings(host_id,title,address,price,spaces,spots,time_zone,availability) values($1,'Synthetic refund policy fixture','Toronto ON M5V 2T6',12,1,'[{"forRent":true}]','America/Toronto','{"version":1,"preset":"anytime","timezone":"America/Toronto","weekly":{},"exceptions":[]}'::jsonb) returning id`,[host])).rows[0].id;
    const bid=(await db.query(`insert into public.bookings(listing_id,renter_id,status,hours,total,paid_at,spot_label,stripe_connected_account_id,stripe_payment_intent_id,stripe_charge_id) values($1,$2,'confirmed',1,100.01,now(),'A','acct_policy_fixture','pi_policy_fixture','ch_policy_fixture') returning id`,[listing,driver])).rows[0].id;
    const base={booking_id:bid,requested_by:driver,actor:'staff',action:'refund',reason_code:'staff_goodwill',explanation:'Approved synthetic test',fee_payer:'parkshare',connected_account_id:'acct_policy_fixture',payment_intent_id:'pi_policy_fixture',charge_id:'ch_policy_fixture',livemode:false,gross_cents:10001,amount_cents:3333,processing_fee_cents:321};
    const reserve=async change=>(await db.query('select public.reserve_booking_refund($1::jsonb) op',[JSON.stringify({...base,...change})])).rows[0].op;
    const first=await reserve({request_key:'partial-fixture-1'});
    const replay=await reserve({request_key:'partial-fixture-1',amount_cents:9999,fee_payer:'host'});
    assert.equal(replay.id,first.id);assert.equal(replay.amount_cents,3333);assert.equal(replay.fee_payer,'parkshare');check('replay freezes financial amount and responsibility');
    await db.exec('savepoint expected_error');
    await assert.rejects(()=>reserve({request_key:'partial-fixture-2'}),/refund_operation_pending_review/);
    await db.exec('rollback to savepoint expected_error');check('competing request is blocked until the first operation settles');
    const token='00000000-0000-4000-8000-00000000f603';
    assert.ok((await db.query('select public.claim_booking_refund($1,$2) op',[first.id,token])).rows[0].op);
    assert.equal((await db.query('select public.claim_booking_refund($1,$2) op',[first.id,token])).rows[0].op,null);check('database lease grants only one claim');
    await db.exec('savepoint expected_error');
    await assert.rejects(()=>db.query('select public.allocate_refund_fee_credit($1,$2)',[first.id,token]),/refund_not_succeeded/);
    await db.exec('rollback to savepoint expected_error');check('no fee credit before a successful customer refund');
    let cumulative=0,refunded=0;
    for(let i=0;i<3;i++){
      const op=i===0?first:await reserve({request_key:'partial-fixture-'+(i+1),amount_cents:i===2?3335:3333});
      if(i>0)await db.query('select public.claim_booking_refund($1,$2)',[op.id,token]);
      await db.query("update public.booking_refund_operations set refund_status='succeeded',refund_id=$2 where id=$1",[op.id,'re_policy_'+i]);
      const allocated=(await db.query('select public.allocate_refund_fee_credit($1,$2) op',[op.id,token])).rows[0].op;
      const repeat=(await db.query('select public.allocate_refund_fee_credit($1,$2) op',[op.id,token])).rows[0].op;
      assert.equal(repeat.fee_credit_cents,allocated.fee_credit_cents);cumulative+=Number(allocated.fee_credit_cents);refunded+=Number(op.amount_cents);
      assert.equal(cumulative,Math.round(321*refunded/10001));assert.ok(cumulative<=321);
      await db.query("update public.booking_refund_operations set state='complete' where id=$1",[op.id]);
    }
    assert.equal(cumulative,321);check('successive partials round cumulatively, replay safely, and never exceed actual original fee');
    assert.equal((await db.query('select status from public.bookings where id=$1',[bid])).rows[0].status,'confirmed');check('partial requests do not cancel an active booking');
    for(const role of ['anon','authenticated']){
      for(const table of ['booking_refund_operations','booking_cancellation_reviews'])assert.equal((await db.query('select has_table_privilege($1,$2,\'INSERT\') allowed',[role,'public.'+table])).rows[0].allowed,false);
      for(const signature of ['reserve_booking_refund(jsonb)','claim_booking_refund(uuid,uuid)','allocate_refund_fee_credit(uuid,uuid)'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,'public.'+signature])).rows[0].allowed,false);
    }
    check('browser roles cannot insert money operations or invoke privileged RPCs');
  } finally {await db.exec('rollback');}
}
