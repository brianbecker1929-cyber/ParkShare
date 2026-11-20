import assert from 'node:assert/strict';

// Synthetic rows only; caller supplies one disposable-DB connection.
export async function seedMessagePrivacyRows(db,{host,driver,other,listing}) {
  const ids=[];
  for(const [sender,recipient] of [[driver,host],[host,driver],[other,host],[host,other],[driver,null]]) {
    const r=await db.query('INSERT INTO public.messages(listing_id,sender_id,recipient_id,text) VALUES($1,$2,$3,$4) RETURNING id',
      [listing,sender,recipient,'Synthetic private message']);
    ids.push(r.rows[0].id);
  }
  return ids;
}

export function messagePrivacyChecks(db,{host,driver,other,listing,ids}) {
  async function as(role,id,sql,args=[]) {
    await db.exec('BEGIN; SET LOCAL ROLE '+role+';');
    try {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[id??'']);
      const r=await db.query(sql,args); await db.exec('COMMIT;'); return r;
    } catch(e){await db.exec('ROLLBACK;');throw e;}
  }
  const denied=fn=>assert.rejects(fn,e=>e.code==='42501');
  const visible=async user=>(await as('authenticated',user,'SELECT id FROM public.messages WHERE listing_id=$1 ORDER BY id',[listing])).rows.map(r=>r.id);
  return [
    ['BUG-005119 Driver A cannot read Driver B thread on the same listing',async()=>{
      assert.deepEqual(await visible(driver),[ids[0],ids[1],ids[4]]);
      assert.deepEqual(await visible(other),[ids[2],ids[3]]);
    }],
    ['BUG-005119 Host sees actual incoming/outgoing messages, not unaddressed legacy rows',async()=>{
      assert.deepEqual(await visible(host),ids.slice(0,4));
    }],
    ['BUG-005119 unrelated and missing identities see no messages',async()=>{
      assert.deepEqual(await visible('00000000-0000-4000-8000-000000005119'),[]);
      assert.deepEqual(await visible(null),[]);
    }],
    ['BUG-005119 anonymous reads and writes are denied',async()=>{
      await denied(()=>as('anon',null,'SELECT id,text FROM public.messages'));
      await denied(()=>as('anon',null,'INSERT INTO public.messages(listing_id,sender_id,recipient_id,text) VALUES($1,$2,$3,$4)',[listing,driver,host,'Blocked']));
    }],
    ['BUG-005119 direct browser message creation/edit/delete/truncate are denied',async()=>{
      await denied(()=>as('authenticated',driver,'INSERT INTO public.messages(listing_id,sender_id,recipient_id,text) VALUES($1,$2,$3,$4)',[listing,driver,other,'Forged recipient']));
      await denied(()=>as('authenticated',driver,"UPDATE public.messages SET text='Edited' WHERE id=$1",[ids[0]]));
      await denied(()=>as('authenticated',driver,'DELETE FROM public.messages WHERE id=$1',[ids[0]]));
      await denied(()=>as('authenticated',driver,'TRUNCATE public.messages'));
    }],
    ['BUG-005119 extra permissive read rule cannot reopen other conversations',async()=>{
      await db.exec('CREATE POLICY "Synthetic broad message read" ON public.messages FOR SELECT TO authenticated USING(true);');
      try {assert.deepEqual(await visible(other),[ids[2],ids[3]]);}
      finally {await db.exec('DROP POLICY "Synthetic broad message read" ON public.messages;');}
    }],
    ['BUG-005119 filtered counts cannot reveal another Driver thread',async()=>{
      const r=await as('authenticated',other,'SELECT count(*) n FROM public.messages WHERE sender_id=$1 OR recipient_id=$1',[driver]);
      assert.equal(Number(r.rows[0].n),0);
    }],
    ['BUG-005119 server retains insertion/read access and legacy participant is not inferred',async()=>{
      await db.exec('BEGIN; SET LOCAL ROLE service_role;');
      try {
        const r=await db.query('INSERT INTO public.messages(listing_id,sender_id,recipient_id,text) VALUES($1,$2,$3,$4) RETURNING id',[listing,host,driver,'Synthetic server reply']);
        assert.ok(r.rows[0].id);
      }finally{await db.exec('ROLLBACK;');}
      assert.equal((await db.query('SELECT recipient_id FROM public.messages WHERE id=$1',[ids[4]])).rows[0].recipient_id,null);
    }],
  ];
}
