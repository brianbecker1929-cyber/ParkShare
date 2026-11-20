import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export const messageNotificationSql = new URL('../docs/sql-proposals/qa-message-notifications-005536.sql',import.meta.url);

export async function runMessageNotificationProbe(db, report, peerConnection) {
  const check = name => report.checks.push({name:'message notifications: '+name,status:'passed'});
  const host='00000000-0000-4000-8000-000000005361', driver='00000000-0000-4000-8000-000000005362';
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'chat-host@example.invalid','{"role":"host"}'),($2,'chat-driver@example.invalid','{"role":"driver"}')`,[host,driver]);
  const listing=(await db.query("insert into public.listings(host_id,title,address,price,spaces) values($1,'Synthetic message fixture','Toronto ON M5V 2T6',12,1) returning id",[host])).rows[0].id;
  const insert=connection=>connection.query('insert into public.messages(listing_id,sender_id,recipient_id,text) values($1,$2,$3,$4) returning id',[listing,driver,host,'Synthetic private chat']);
  const old=(await insert(db)).rows[0].id;
  await db.exec(await readFile(messageNotificationSql,'utf8'));
  report.migrations.push({name:'qa_message_notifications_005536',status:'passed'});
  assert.equal(Number((await db.query('select count(*) n from public.message_email_deliveries')).rows[0].n),0);
  check('migration creates no historical-message jobs');
  await db.exec('begin; set local role service_role;');
  let id;
  try {id=(await insert(db)).rows[0].id;await db.exec('commit;');}
  catch(error){await db.exec('rollback;');throw error;}
  assert.notEqual(id,old);
  assert.equal(Number((await db.query('select message_id from public.message_email_deliveries where message_id=$1',[id])).rows[0].message_id),Number(id));
  check('the existing service-role message insert atomically creates one private job');

  await db.exec('begin; set local role service_role;');
  const undone=(await insert(db)).rows[0].id;
  assert.equal((await db.query('select count(*)::int n from public.message_email_deliveries where message_id=$1',[undone])).rows[0].n,1);
  await db.exec('rollback;');
  assert.equal((await db.query('select count(*)::int n from public.message_email_deliveries where message_id=$1',[undone])).rows[0].n,0);
  check('rolling back a message also rolls back its email job');
  for(const role of ['anon','authenticated']) {
    for(const sql of ['select * from public.message_email_deliveries','update public.message_email_deliveries set blocked_at=now()']) {
      await db.exec('begin; set local role '+role+';');
      try {await assert.rejects(()=>db.query(sql),error=>error.code==='42501');}
      finally {await db.exec('rollback;');}
    }
  }
  const permissions=(await db.query(`select c.relrowsecurity rls,
    has_table_privilege('authenticated','public.message_email_deliveries','INSERT') client_insert,
    has_function_privilege('anon','parkshare_private.queue_message_email()','EXECUTE') anon_execute,
    p.prosecdef definer from pg_class c,pg_proc p where c.oid='public.message_email_deliveries'::regclass and p.oid='parkshare_private.queue_message_email()'::regprocedure`)).rows[0];
  assert.deepEqual(permissions,{rls:true,client_insert:false,anon_execute:false,definer:false});
  check('clients cannot read, write, enqueue or invoke privileged code; trigger is invoker');

  const peer=await peerConnection();
  try {
    const claim=connection=>connection.query(`update public.message_email_deliveries set lease_until=now()+interval '2 minutes'
      where message_id=$1 and sent_at is null and blocked_at is null and lease_until<=now() returning message_id`,[id]);
    const claims=await Promise.all([claim(db),claim(peer)]);
    assert.equal(claims.reduce((n,r)=>n+r.rowCount,0),1);
    check('two independent database workers claim a pending message once');
    await db.query("update public.message_email_deliveries set lease_until='-infinity',sent_at=now(),provider_id='synthetic-provider' where message_id=$1",[id]);
    assert.equal((await claim(peer)).rowCount,0);
    check('provider acceptance prevents replay after a lease expires');
  } finally {await peer.end();}
  await db.query('delete from public.messages where id=$1',[id]);
  assert.equal((await db.query('select count(*)::int n from public.message_email_deliveries where message_id=$1',[id])).rows[0].n,0);
  check('message deletion cleans up its private queue record');
}
