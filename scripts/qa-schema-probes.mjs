import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadSnapshot, restoreSnapshot, applyProposals, proposals } from './qa-schema-rehearsal.mjs';

const HOST='00000000-0000-4000-8000-00000000e181';
const DRIVER='00000000-0000-4000-8000-00000000e182';
const OTHER='00000000-0000-4000-8000-00000000e183';
const ACCOUNT='acct_synthetic_rehearsal';
const readProposal=name=>readFile(new URL('../docs/sql-proposals/'+name,import.meta.url),'utf8');
const rpc={hold:'public.create_booking_hold(bigint,uuid,text,timestamptz,timestamptz,timestamptz)',reserve:'public.reserve_extension_checkout_hold(bigint,uuid,numeric,timestamptz)',apply:'public.apply_paid_booking_extension(text,bigint,uuid,numeric,integer,text,text,text,timestamptz)'};

export async function runSchemaProbes(db, report={checks:[],migrations:[]}) {
  const snapshot=await loadSnapshot();
  const query=(sql,args=[])=>db.query(sql,args);
  const row=async(sql,args=[])=> (await query(sql,args)).rows[0];
  const check=async(name,fn)=>{await fn();report.checks.push({name,status:'passed'});};
  const denied=async(fn,code)=>assert.rejects(fn,e=>e.code===code,`Expected SQLSTATE ${code}`);
  async function as(role,user,sql,args=[]) {
    await db.exec('BEGIN; SET LOCAL ROLE '+role+';');
    try {
      await query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user??'']);
      const r=await query(sql,args); await db.exec('COMMIT;'); return r;
    } catch(e){await db.exec('ROLLBACK;');throw e;}
  }
  await check('remote/QA source is PostgreSQL 17; local engine also PostgreSQL 17',async()=>{
    report.engine=(await row('SELECT version() version')).version;
    assert.ok(snapshot.inventory.version.startsWith('PostgreSQL 17.'));
    assert.ok(report.engine.startsWith('PostgreSQL 17.'));
  });
  await restoreSnapshot(db,snapshot);
  await check('all captured tables, columns, constraints, indexes, triggers and policies restored',async()=>{
    const namespaces="('public','auth','storage')";
    const counts=await row(`SELECT
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ${namespaces} AND c.relkind='r') tables,
      (SELECT count(*)::int FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ${namespaces} AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped) columns,
      (SELECT count(*)::int FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname IN ${namespaces}) constraints,
      (SELECT count(*)::int FROM pg_indexes WHERE schemaname IN ${namespaces}) indexes,
      (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ${namespaces} AND NOT t.tgisinternal) triggers,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname IN ${namespaces}) policies`);
    assert.deepEqual(counts,{
      tables:snapshot.inventory.relations.filter(t=>t.kind==='r').length,
      columns:snapshot.structure.columns.length,
      constraints:snapshot.structure.constraints.length,
      indexes:snapshot.code.indexes.length+snapshot.structure.constraints.filter(c=>['p','u','x'].includes(c.type)).length,
      triggers:snapshot.code.triggers.length,policies:snapshot.inventory.policies.length,
    });
    report.restored=counts;
  });
  await check('existing inherited profile column grants are included in the fixture',async()=>{
    assert.equal((await row("SELECT has_column_privilege('anon','public.profiles','name','SELECT') allowed")).allowed,true);
    assert.equal((await row("SELECT has_table_privilege('anon','public.profiles','SELECT') allowed")).allowed,false);
  });
  // All rows below are synthetic. QA application rows are never exported.
  for(const [id,role] of [[HOST,'host'],[DRIVER,'driver'],[OTHER,'driver']]) await query(
    "INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,jsonb_build_object('name','Synthetic rehearsal','role',$3::text))",
    [id,role+id.slice(-4)+'@example.invalid',role]);
  const listing=(await row("INSERT INTO public.listings(host_id,title,address,price,spaces) VALUES($1,'Synthetic legacy listing','Historical address without postal code',900,4) RETURNING id",[HOST])).id;
  const legacy=(await row("INSERT INTO public.bookings(listing_id,renter_id,hours,total,status,booking_date,start_hour,spot_label,paid_at,stripe_connected_account_id) VALUES($1,$2,2,1800,'confirmed','2026-10-20',14,'A','2026-10-17T12:00Z',$3) RETURNING id",[listing,DRIVER,ACCOUNT])).id;
  const original=(await row('SELECT to_jsonb(b) snapshot FROM public.bookings b WHERE id=$1',[legacy])).snapshot;
  await query("INSERT INTO public.reviews(listing_id,user_id,rating,text) VALUES($1,$2,5,'Synthetic historical review')",[listing,DRIVER]);
  await query("INSERT INTO storage.objects(bucket_id,name,owner) VALUES('listing-photos',$1,$2)",[HOST+'/synthetic.jpg',HOST]);

  await check('all nine proposals apply consecutively to the complete captured schema',async()=>{
    await applyProposals(db,report.migrations);
    assert.equal(report.migrations.length,9);
  });
  await check('existing paid booking columns and UTC interval remain unchanged',async()=>{
    const updated=(await row("SELECT to_jsonb(b)-'scheduled_starts_at'-'property_time_zone' snapshot FROM public.bookings b WHERE id=$1",[legacy])).snapshot;
    assert.deepEqual(updated,original);
  });
  await check('legacy listing address and CAD 900 rate are preserved',async()=>{
    const l=await row('SELECT address,price,time_zone FROM public.listings WHERE id=$1',[listing]);
    assert.equal(l.address,'Historical address without postal code');assert.equal(Number(l.price),900);assert.equal(l.time_zone,null);
    await as('authenticated',HOST,'UPDATE public.listings SET title=$1 WHERE id=$2',['Synthetic edited title',listing]);
    assert.equal((await row('SELECT title FROM public.listings WHERE id=$1',[listing])).title,'Synthetic edited title');
  });
  await check('new malformed postal suffix and fractional-cent price are rejected',async()=>{
    await denied(()=>query("INSERT INTO public.listings(host_id,title,address,price) VALUES($1,'Synthetic invalid','Missing postal',12)",[HOST]),'23514');
    await denied(()=>query("INSERT INTO public.listings(host_id,title,address,price) VALUES($1,'Synthetic invalid','100 Test Lane, Toronto, ON M5V 2T6',12.999)",[HOST]),'23514');
  });
  await check('anon cannot read raw listings or reviews, including address columns',async()=>{
    for(const table of ['listings','reviews']) await denied(()=>as('anon',null,'SELECT * FROM public.'+table),'42501');
  });
  await check('inherited anon profile name/id/role grants are also revoked by privacy cutover',async()=>{
    await denied(()=>as('anon',null,'SELECT id,name,role FROM public.profiles'),'42501');
  });
  await check('unrelated Driver cannot read another Host raw listing or profile',async()=>{
    assert.equal((await as('authenticated',OTHER,'SELECT id FROM public.listings')).rows.length,0);
    assert.equal((await as('authenticated',OTHER,'SELECT id FROM public.profiles WHERE id=$1',[HOST])).rows.length,0);
  });
  await check('Host can read own listing and own profile after privacy changes',async()=>{
    assert.equal((await as('authenticated',HOST,'SELECT id FROM public.listings WHERE id=$1',[listing])).rows.length,1);
    assert.equal((await as('authenticated',HOST,'SELECT id FROM public.profiles')).rows.length,1);
  });
  await check('paid Driver can read booking but exact raw listing remains API-only',async()=>{
    assert.equal((await as('authenticated',DRIVER,'SELECT id FROM public.bookings WHERE id=$1',[legacy])).rows.length,1);
    assert.equal((await as('authenticated',DRIVER,'SELECT address FROM public.listings WHERE id=$1',[listing])).rows.length,0);
  });
  await check('public photo bucket becomes private; Host object RLS still isolates owners',async()=>{
    assert.equal((await row("SELECT public FROM storage.buckets WHERE id='listing-photos'")).public,false);
    assert.equal((await as('anon',null,'SELECT name FROM storage.objects')).rows.length,0);
    assert.equal((await as('authenticated',OTHER,'SELECT name FROM storage.objects')).rows.length,0);
    assert.equal((await as('authenticated',HOST,'SELECT name FROM storage.objects')).rows.length,1);
  });
  await check('browser roles cannot invoke payment RPCs; service_role retains execution',async()=>{
    for(const signature of Object.values(rpc)) {
      assert.deepEqual(await row("SELECT has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') member,has_function_privilege('service_role',$1,'EXECUTE') server",[signature]),{anon:false,member:false,server:true});
    }
  });
  await check('Host cannot assign a trusted property time zone directly',async()=>{
    await denied(()=>as('authenticated',HOST,"UPDATE public.listings SET time_zone='America/Vancouver' WHERE id=$1",[listing]),'42501');
  });
  await as('service_role',null,"UPDATE public.listings SET time_zone='America/Toronto' WHERE id=$1",[listing]);
  await check('canonical property-local booking uses its UTC snapshot',async()=>{
    const b=await row("INSERT INTO public.bookings(listing_id,renter_id,hours,total,status,booking_date,start_hour,spot_label,paid_at,scheduled_starts_at,property_time_zone) VALUES($1,$2,1,12,'confirmed','2026-10-21',14,'B',now(),'2026-10-21T18:00Z','America/Toronto') RETURNING lower(session_range) start",[listing,OTHER]);
    assert.equal(new Date(b.start).toISOString(),'2026-10-21T18:00:00.000Z');
  });
  await check('past or unverified-zone exceptions fail; trusted future dates remain allowed',async()=>{
    const availability={timezone:'America/Toronto',exceptions:[{startDate:'2000-01-01',endDate:'2000-01-02'}]};
    await denied(()=>as('authenticated',HOST,'UPDATE public.listings SET availability=$1::jsonb WHERE id=$2',[JSON.stringify(availability),listing]),'23514');
    const future=(await row("SELECT ((clock_timestamp() AT TIME ZONE 'America/Toronto')::date+1)::text date")).date;
    const valid={timezone:'America/Toronto',exceptions:[{startDate:future,endDate:future}]};
    await as('authenticated',HOST,'UPDATE public.listings SET availability=$1::jsonb WHERE id=$2',[JSON.stringify(valid),listing]);
    await denied(()=>as('authenticated',HOST,"INSERT INTO public.listings(host_id,title,address,price,availability) VALUES($1,'Unverified synthetic zone','100 Test Lane, Toronto, ON M5V 2T6',12,$2::jsonb)",[HOST,JSON.stringify(valid)]),'23514');
  });
  await check('review writes are server-only and duplicate reviewer/listing is rejected',async()=>{
    await denied(()=>as('authenticated',DRIVER,"INSERT INTO public.reviews(listing_id,user_id,rating,text) VALUES($1,$2,5,'Disallowed direct review')",[listing,DRIVER]),'42501');
    await denied(()=>as('service_role',null,"INSERT INTO public.reviews(listing_id,user_id,rating,text) VALUES($1,$2,5,'Duplicate synthetic review')",[listing,DRIVER]),'23505');
  });
  await check('Driver and Host account deletion cannot cascade away financial records',async()=>{
    for(const id of [DRIVER,HOST]) await denied(()=>query('DELETE FROM auth.users WHERE id=$1',[id]),'23503');
    assert.equal((await row('SELECT count(*)::int n FROM public.bookings WHERE id=$1',[legacy])).n,1);
  });
  // Use the actual QA booking trigger and all constraints for an active paid extension.
  const active=(await row("INSERT INTO public.bookings(listing_id,renter_id,hours,total,status,spot_label,paid_at,stripe_connected_account_id) VALUES($1,$2,1,12,'confirmed','C',now()-interval '30 minutes',$3) RETURNING id",[listing,DRIVER,ACCOUNT])).id;
  let hold;
  await check('service-role reserves extension tail with the actual QA schema and trigger',async()=>{
    hold=(await as('service_role',null,"SELECT * FROM public.reserve_extension_checkout_hold($1,$2,1,now()+interval '30 minutes')",[active,DRIVER])).rows[0];
    assert.ok(hold.hold_id);
    assert.equal(new Date(hold.ends_at)-new Date(hold.starts_at),3600000);
  });
  const session='cs_test_synthetic_full_schema';
  await as('service_role',null,'UPDATE public.booking_holds SET stripe_checkout_session_id=$1 WHERE id=$2',[session,hold.hold_id]);
  await as('service_role',null,"INSERT INTO public.pending_booking_extensions(booking_id,renter_id,added_hours,expected_total_cents,expected_service_fee_cents,expected_connected_account_id,stripe_checkout_session_id,hold_id) VALUES($1,$2,1,1200,100,$3,$4,$5)",[active,DRIVER,ACCOUNT,session,hold.hold_id]);
  const apply=account=>as('service_role',null,"SELECT * FROM public.apply_paid_booking_extension($1,$2,$3,1,1200,'pi_test_synthetic','ch_test_synthetic',$4,now())",[session,active,DRIVER,account]);
  await check('wrong connected account fails without extending the booking',async()=>{
    await denied(()=>apply('acct_wrong_synthetic'),'22023');
    assert.equal(Number((await row('SELECT hours FROM public.bookings WHERE id=$1',[active])).hours),1);
  });
  await check('paid extension atomically updates hours and audit, consuming its hold',async()=>{
    assert.equal((await apply(ACCOUNT)).rows[0].applied,true);
    assert.equal(Number((await row('SELECT hours FROM public.bookings WHERE id=$1',[active])).hours),2);
    assert.equal((await row('SELECT count(*)::int n FROM public.booking_holds WHERE id=$1',[hold.hold_id])).n,0);
  });
  await check('extension replay is idempotent and does not add another hour or ledger row',async()=>{
    assert.equal((await apply(ACCOUNT)).rows[0].applied,false);
    assert.equal(Number((await row('SELECT hours FROM public.bookings WHERE id=$1',[active])).hours),2);
    assert.equal((await row('SELECT count(*)::int n FROM public.booking_extensions WHERE booking_id=$1',[active])).n,1);
  });
  await check('two active unpaid holds block a third reservation with P0058',async()=>{
    for(const offset of [3,5]) await as('service_role',null,"SELECT public.create_booking_hold($1,$2,'D',now()+$3*interval '1 hour',now()+($3+1)*interval '1 hour',now()+interval '30 minutes')",[listing,OTHER,offset]);
    await denied(()=>as('service_role',null,"SELECT public.create_booking_hold($1,$2,'D',now()+interval '7 hours',now()+interval '8 hours',now()+interval '30 minutes')",[listing,OTHER]),'P0058');
  });
  await check('reapplying timezone SQL fails atomically: versioned migrations must not be replayed blindly',async()=>{
    const before=(await row('SELECT to_jsonb(b) b FROM public.bookings b WHERE id=$1',[legacy])).b;
    await denied(async()=>{try{await db.exec(await readProposal(proposals[2]));}finally{await db.exec('ROLLBACK;');}},'42710');
    assert.deepEqual((await row('SELECT to_jsonb(b) b FROM public.bookings b WHERE id=$1',[legacy])).b,before);
  });
  // Deliberately test the cross-proposal trust boundary, rather than merely
  // proving each trigger can be installed. This is a release gate, not a fix.
  await as('service_role',null,"UPDATE public.listings SET time_zone='Pacific/Kiritimati' WHERE id=$1",[listing]);
  const dates=await row("SELECT (clock_timestamp() AT TIME ZONE 'Pacific/Kiritimati')::date::text property_today,(clock_timestamp() AT TIME ZONE 'Pacific/Pago_Pago')::date::text supplied_today");
  assert.ok(dates.supplied_today<dates.property_today);
  const spoofed={timezone:'Pacific/Pago_Pago',exceptions:[{startDate:dates.supplied_today,endDate:dates.supplied_today}]};
  try {
    await as('authenticated',HOST,'UPDATE public.listings SET availability=$1::jsonb WHERE id=$2',[JSON.stringify(spoofed),listing]);
    report.findings=[{id:'RC182-TZ-EXCEPTION-TRUST',severity:'release-blocker',
      message:'BUG-005138 trigger accepts a past property-local exception by trusting availability.timezone instead of protected listings.time_zone.',
      propertyZone:'Pacific/Kiritimati',suppliedZone:'Pacific/Pago_Pago',...dates,
      affectedProposal:'bug-005138-future-exceptions.sql',reproducedAs:'authenticated owning Host'}];
  } catch(e) {
    if(e.code!=='23514') throw e;
    report.findings=[];
    report.checks.push({name:'spoofed availability timezone cannot bypass property-local exception date',status:'passed'});
  }
  // Fault injection: reproduce a review collision in a fresh LOCAL restore.
  await restoreSnapshot(db,snapshot);
  for(const [id,role] of [[HOST,'host'],[DRIVER,'driver']]) await query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,jsonb_build_object('role',$3::text))",[id,id+'@example.invalid',role]);
  const collisionListing=(await row("INSERT INTO public.listings(host_id,title,address,price) VALUES($1,'Synthetic collision','100 Test Lane, Toronto, ON M5V 2T6',12) RETURNING id",[HOST])).id;
  await query("INSERT INTO public.reviews(listing_id,user_id,rating,text) VALUES($1,$2,5,'Synthetic duplicate one'),($1,$2,4,'Synthetic duplicate two')",[collisionListing,DRIVER]);
  const failedTrace=[];
  await check('duplicate review data stops migration 7 and restores its prior policy/grants',async()=>{
    await denied(()=>applyProposals(db,failedTrace),'23505');
    assert.equal(failedTrace.filter(t=>t.status==='passed').length,6);
    assert.equal((await row("SELECT count(*)::int n FROM pg_policies WHERE schemaname='public' AND tablename='reviews' AND policyname='Authenticated users can leave reviews'")).n,1);
    assert.equal((await row("SELECT has_table_privilege('authenticated','public.reviews','INSERT') allowed")).allowed,true);
    assert.equal((await row("SELECT public FROM storage.buckets WHERE id='listing-photos'")).public,true);
  });
  await check('controlled collision recovery resumes only uncommitted proposals 7-9',async()=>{
    await query('DELETE FROM public.reviews WHERE id=(SELECT max(id) FROM public.reviews)');
    for(const name of proposals.slice(6)) await db.exec(await readProposal(name));
    assert.equal((await row("SELECT public FROM storage.buckets WHERE id='listing-photos'")).public,false);
    assert.equal((await row('SELECT count(*)::int n FROM public.reviews')).n,1);
  });
  report.faultInjection=failedTrace;
  return report;
}
