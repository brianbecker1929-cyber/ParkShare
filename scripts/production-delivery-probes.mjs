// Database-level concurrency only: no mail, Stripe, HTTP, or worker invocation.
import assert from 'node:assert/strict';
import pg from 'pg';
export async function runProductionDeliveryProbes(db,report,config,fixture){
 const check=name=>report.checks.push({name:'production queues: '+name,status:'passed'});
 const peers=[new pg.Client(config),new pg.Client(config)];
 try{
  for(const p of peers){await p.connect();await p.query('SET ROLE service_role');}
  const booking=fixture.bookings[1];
  const insertMessage=()=>db.query("INSERT INTO public.messages(listing_id,sender_id,recipient_id,text) VALUES($1,$2,$3,'Synthetic new production-shaped chat') RETURNING id",[fixture.listing,fixture.driver,fixture.host]);
  await db.exec('BEGIN;SET LOCAL ROLE service_role');
  const undone=(await insertMessage()).rows[0].id;
  assert.equal((await db.query('SELECT count(*)::int n FROM public.message_email_deliveries WHERE message_id=$1',[undone])).rows[0].n,1);
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int n FROM public.message_email_deliveries WHERE message_id=$1',[undone])).rows[0].n,0);
  check('a rolled-back new message leaves no email job');
  const message=(await insertMessage()).rows[0].id;
  const claimMessage=p=>p.query("UPDATE public.message_email_deliveries SET lease_until=now()+interval '2 minutes' WHERE message_id=$1 AND sent_at IS NULL AND blocked_at IS NULL AND lease_until<=now() RETURNING message_id",[message]);
  let outcomes=await Promise.all(peers.map(claimMessage));assert.equal(outcomes.reduce((n,r)=>n+r.rowCount,0),1);
  check('independent workers claim one new chat email only once');
  await db.query("UPDATE public.message_email_deliveries SET payload='{}',first_attempt_at=now(),provider_id='synthetic_chat_acceptance',sent_at=now(),lease_until='-infinity' WHERE message_id=$1",[message]);
  assert.equal((await claimMessage(peers[0])).rowCount,0);check('accepted chat mail cannot replay after lease expiry');

  const reminder={id:'synthetic-production-halfway',booking_id:booking,kind:'halfway',session_ends_at:'2026-12-02T16:00Z',payload:{to:'driver@example.invalid',subject:'Synthetic'} };
  const insertReminder=(p,id)=>p.query("INSERT INTO public.booking_reminder_deliveries(id,booking_id,kind,session_ends_at,payload) VALUES($1,$2,$3,$4,$5)",[id,booking,reminder.kind,reminder.session_ends_at,reminder.payload]);
  const created=await Promise.allSettled(peers.map((p,i)=>insertReminder(p,reminder.id+i)));
  assert.equal(created.filter(r=>r.status==='fulfilled').length,1);assert.equal(created.filter(r=>r.status==='rejected'&&r.reason.code==='23505').length,1);
  check('concurrent reminder creation permits one record per booking and kind');
  const claimReminder=p=>p.query("UPDATE public.booking_reminder_deliveries SET lease_until=now()+interval '2 minutes' WHERE booking_id=$1 AND kind='halfway' AND sent_at IS NULL AND lease_until<=now() RETURNING id",[booking]);
  outcomes=await Promise.all(peers.map(claimReminder));assert.equal(outcomes.reduce((n,r)=>n+r.rowCount,0),1);
  await db.query("UPDATE public.booking_reminder_deliveries SET sent_at=now(),provider_id='synthetic_reminder_acceptance',lease_until='-infinity' WHERE booking_id=$1",[booking]);
  assert.equal((await claimReminder(peers[1])).rowCount,0);check('reminder lease and provider marker prevent concurrent and accepted replay');

  await peers[0].query(`INSERT INTO public.payment_refunds(connected_account_id,livemode,refund_id,booking_id,payment_intent_id,charge_id,currency,amount_cents,status,stripe_created_at,source_event_id)
    VALUES('acct_prod_fixture',false,'re_concurrent_fixture',$1,'pi_fixture_1','ch_fixture_1','cad',100,'succeeded',clock_timestamp(),'evt_concurrent_fixture')`,[booking]);
  assert.equal((await db.query("SELECT count(*)::int n FROM public.refund_email_deliveries WHERE refund_id='re_concurrent_fixture'")).rows[0].n,2);
  const receipt=(await db.query("SELECT id FROM public.refund_email_deliveries WHERE refund_id='re_concurrent_fixture' AND audience='driver'")).rows[0].id;
  const claimReceipt=p=>p.query("UPDATE public.refund_email_deliveries SET lease_until=now()+interval '2 minutes' WHERE id=$1 AND sent_at IS NULL AND blocked_at IS NULL AND lease_until<=now() RETURNING id",[receipt]);
  outcomes=await Promise.all(peers.map(claimReceipt));assert.equal(outcomes.reduce((n,r)=>n+r.rowCount,0),1);
  check('successful verified refund creates separate audience receipts and one worker claim');

  const opInput={booking_id:booking,request_key:'production-lease-fixture',requested_by:fixture.driver,actor:'staff',action:'refund',reason_code:'staff_goodwill',explanation:'Synthetic only',fee_payer:'parkshare',connected_account_id:'acct_prod_fixture',payment_intent_id:'pi_fixture_1',charge_id:'ch_fixture_1',livemode:false,gross_cents:10000,amount_cents:3700,processing_fee_cents:300};
  const operation=(await peers[0].query('SELECT public.reserve_booking_refund($1::jsonb) op',[JSON.stringify(opInput)])).rows[0].op;
  const tokens=['00000000-0000-4000-8000-00000000c701','00000000-0000-4000-8000-00000000c702'];
  outcomes=await Promise.all(peers.map((p,i)=>p.query('SELECT public.claim_booking_refund($1,$2) op',[operation.id,tokens[i]])));
  const winners=outcomes.map((r,i)=>({op:r.rows[0].op,token:tokens[i]})).filter(r=>r.op);
  assert.equal(winners.length,1);check('independent refund workers receive one financial-operation lease');
  const {token}=winners[0];
  await assert.rejects(()=>peers[0].query('SELECT public.allocate_refund_fee_credit($1,$2)',[operation.id,token]),/refund_not_succeeded/);
  await db.query("UPDATE public.booking_refund_operations SET refund_status='succeeded',refund_id='re_operation_fixture' WHERE id=$1",[operation.id]);
  const allocated=(await peers[0].query('SELECT public.allocate_refund_fee_credit($1,$2) op',[operation.id,token])).rows[0].op;
  const repeated=(await peers[1].query('SELECT public.allocate_refund_fee_credit($1,$2) op',[operation.id,token])).rows[0].op;
  assert.equal(Number(allocated.fee_credit_cents),111);assert.equal(repeated.fee_credit_cents,allocated.fee_credit_cents);
  check('fee credit waits for success, uses the proportional actual fee and is stable on retry');
 }finally{for(const p of peers)await p.end();}
}
