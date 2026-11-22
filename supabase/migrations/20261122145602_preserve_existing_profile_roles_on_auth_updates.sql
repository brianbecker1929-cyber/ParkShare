-- Preserve server-assigned account roles when Auth metadata changes.
-- New signups still choose their initial Driver/Host role. Existing profiles
-- keep their role, listing ownership and payout configuration.
create or replace function public.handle_new_parkshare_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'driver')
  )
  on conflict (id) do update set
    name = excluded.name,
    email = excluded.email;
  return new;
end;
$function$;
