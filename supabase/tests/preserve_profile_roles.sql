-- Run with ON_ERROR_STOP and an explicitly designated existing test account:
-- PGOPTIONS='-c parkshare.role_sync_test_user_id=<account UUID>' psql ... -f this-file.sql
-- The probes fire the real Auth trigger, then roll back every test update.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $test$
declare
  target_id uuid := nullif(current_setting('parkshare.role_sync_test_user_id', true), '')::uuid;
  original_profile jsonb;
  original_metadata jsonb;
  original_listings jsonb;
  desired_role text;
  metadata_role text;
  candidate_metadata jsonb;
  probes_rolled_back boolean := false;
begin
  if target_id is null then
    raise exception 'Set parkshare.role_sync_test_user_id to a designated test account UUID';
  end if;
  select to_jsonb(p), u.raw_user_meta_data
    into strict original_profile, original_metadata
    from public.profiles p join auth.users u on u.id=p.id
    where p.id=target_id for update of p,u;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb)
    into original_listings from public.listings l where l.host_id=target_id;

  begin
    foreach desired_role in array array['host','driver'] loop
      update public.profiles set role=desired_role where id=target_id;
      foreach metadata_role in array array['missing','host','driver'] loop
        candidate_metadata := coalesce(original_metadata,'{}'::jsonb)-'role';
        if metadata_role <> 'missing' then
          candidate_metadata := candidate_metadata || jsonb_build_object('role',metadata_role);
        end if;
        update auth.users set raw_user_meta_data=candidate_metadata where id=target_id;
        if (select role from public.profiles where id=target_id) is distinct from desired_role then
          raise exception 'Auth metadata changed assigned % role when metadata role was %',desired_role,metadata_role;
        end if;
      end loop;
    end loop;
    raise exception using errcode='P7702',message='six_role_preservation_probes_passed';
  exception when sqlstate 'P7702' then
    probes_rolled_back:=true;
  end;

  if not probes_rolled_back
    or (select to_jsonb(p) from public.profiles p where id=target_id) is distinct from original_profile
    or (select raw_user_meta_data from auth.users where id=target_id) is distinct from original_metadata
    or (select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb) from public.listings l where l.host_id=target_id) is distinct from original_listings
  then raise exception 'Test data preservation check failed'; end if;
end $test$;
select 'PASS: six real-trigger probes; profile, Auth metadata and listings preserved' as result;
rollback;
