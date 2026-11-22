-- The service-only RPC checks verified identities in Auth. Do not grant the
-- application server direct SELECT access to auth.users. Browser roles remain
-- unable to execute this function; the server supplies the authenticated actor.
set local lock_timeout = '5s';
alter function public.host_listing_application(text,uuid,uuid,jsonb) security definer;
revoke all on function public.host_listing_application(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.host_listing_application(text,uuid,uuid,jsonb) to service_role;
