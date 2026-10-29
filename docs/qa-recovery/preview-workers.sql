-- QA infrastructure only. Apply solely to recovery project heqxirlsorcztsawaldg.
-- Never place this in the application's production migration sequence.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;


create or replace function public.configure_qa_recovery_preview_workers(p_cron_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  claim_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                             current_setting('request.jwt.claim.role', true));
  secret_id uuid;
begin
  if claim_role is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_cron_secret is null or length(p_cron_secret) < 16 or length(p_cron_secret) > 512 then
    raise exception 'Invalid scheduler credential';
  end if;
  select id into secret_id from vault.secrets where name = 'parkshare_qa_recovery_preview_cron';
  if secret_id is null then
    perform vault.create_secret(p_cron_secret, 'parkshare_qa_recovery_preview_cron',
      'Recovery QA Preview workers only; remove at stable-QA cutover');
  else
    perform vault.update_secret(secret_id, p_cron_secret);
  end if;
  return jsonb_build_object('configured', true, 'workers', 2);
end;
$function$;
revoke all on function public.configure_qa_recovery_preview_workers(text) from public, anon, authenticated;
grant execute on function public.configure_qa_recovery_preview_workers(text) to service_role;

select cron.schedule('parkshare-qa-recovery-refund-emails', '* * * * *', $job$
select net.http_get(
  url := 'https://parkshare-qa-git-qa-recovery-preflight-oct27-eska-technologies.vercel.app/api/send-refund-notifications',
  headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'parkshare_qa_recovery_preview_cron')),
  timeout_milliseconds := 300000
) where exists (select 1 from vault.secrets where name = 'parkshare_qa_recovery_preview_cron');
$job$);
select cron.schedule('parkshare-qa-recovery-booking-reminders', '* * * * *', $job$
select net.http_get(
  url := 'https://parkshare-qa-git-qa-recovery-preflight-oct27-eska-technologies.vercel.app/api/send-reminders',
  headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'parkshare_qa_recovery_preview_cron')),
  timeout_milliseconds := 300000
) where exists (select 1 from vault.secrets where name = 'parkshare_qa_recovery_preview_cron');
$job$);
notify pgrst, 'reload schema';
