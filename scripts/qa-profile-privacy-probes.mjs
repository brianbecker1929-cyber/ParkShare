// Run only against synthetic rows in a disposable PostgreSQL schema.
import assert from 'node:assert/strict';

export function profilePrivacyChecks(db, {host, driver, other}) {
  async function as(role, id, sql, args=[]) {
    await db.exec('BEGIN; SET LOCAL ROLE '+role+';');
    try {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[id ?? '']);
      const result=await db.query(sql,args);
      await db.exec('COMMIT;');
      return result;
    } catch(error) { await db.exec('ROLLBACK;'); throw error; }
  }
  const denied=fn=>assert.rejects(fn,e=>e.code==='42501');
  const onlySelf=async id=>{
    const result=await as('authenticated',id,'SELECT id,name,role FROM public.profiles ORDER BY id');
    assert.deepEqual(result.rows.map(r=>r.id),[id]);
  };
  return [
    ['BUG-005200 anonymous profile projection and count are denied',async()=>{
      await denied(()=>as('anon',null,'SELECT id,name,role FROM public.profiles'));
      await denied(()=>as('anon',null,'SELECT count(*) FROM public.profiles'));
    }],
    ['BUG-005200 Driver and Host can read only their own sign-in profile',async()=>{
      await onlySelf(driver); await onlySelf(host);
    }],
    ['BUG-005200 explicit foreign ID and broad OR filter cannot enumerate profiles',async()=>{
      assert.equal((await as('authenticated',driver,'SELECT id,name,role FROM public.profiles WHERE id=$1',[host])).rows.length,0);
      const broad=await as('authenticated',driver,'SELECT id FROM public.profiles WHERE id=$1 OR id IS NOT NULL',[other]);
      assert.deepEqual(broad.rows,[{id:driver}]);
    }],
    ['BUG-005200 counts and pagination expose only the caller row',async()=>{
      assert.equal(Number((await as('authenticated',driver,'SELECT count(*) n FROM public.profiles')).rows[0].n),1);
      assert.equal((await as('authenticated',driver,'SELECT id FROM public.profiles ORDER BY id LIMIT 1 OFFSET 1')).rows.length,0);
    }],
    ['BUG-005200 absent identity cannot use authenticated profile grants',async()=>{
      assert.equal((await as('authenticated',null,'SELECT id,name,role FROM public.profiles')).rows.length,0);
    }],
    ['BUG-005200 browser cannot read email or Stripe fields even on own profile',async()=>{
      for(const columns of ['email','stripe_account_id','*']) {
        await denied(()=>as('authenticated',driver,'SELECT '+columns+' FROM public.profiles WHERE id=$1',[driver]));
      }
    }],
    ['BUG-005200 extra permissive read policy cannot reopen the account directory',async()=>{
      await db.exec('CREATE POLICY "Synthetic accidental broad profile read" ON public.profiles FOR SELECT TO authenticated USING(true);');
      try { await onlySelf(driver); await onlySelf(host); }
      finally { await db.exec('DROP POLICY "Synthetic accidental broad profile read" ON public.profiles;'); }
    }],
    ['BUG-005200 server retains account access while browser profile writes stay denied',async()=>{
      const server=await as('service_role',null,'SELECT id,email,stripe_account_id FROM public.profiles');
      for(const id of [driver,host,other]) assert.ok(server.rows.some(row=>row.id===id));
      await denied(()=>as('authenticated',driver,"UPDATE public.profiles SET role='host' WHERE id=$1",[driver]));
      await denied(()=>as('authenticated',driver,"INSERT INTO public.profiles(id,name,role) VALUES($1,'Forged','host')",[driver]));
      await denied(()=>as('authenticated',driver,'DELETE FROM public.profiles WHERE id=$1',[driver]));
    }],
  ];
}
