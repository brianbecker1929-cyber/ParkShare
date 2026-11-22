-- Staff approval is mandatory for new listings; existing listings are preserved.
set local lock_timeout = '5s';
create table parkshare_private.host_listing_applications (
 id uuid primary key default gen_random_uuid(), host_id uuid not null references public.profiles(id),
 status text not null default 'draft' check(status in ('draft','submitted','approved','rejected')),
 property_key text not null check(property_key ~ '^[0-9a-f]{64}$'), address text not null,
 document_type text not null check(document_type in ('tax','mortgage','utility','license','bank')),
 document_path text not null unique, document_mime text not null, document_size integer not null check(document_size between 1 and 5242880),
 document_uploaded_at timestamptz, listing_payload jsonb, submission_request_id uuid, payload_hash text,
 submitted_at timestamptz, reviewed_at timestamptz, reviewed_by uuid references auth.users(id), review_note text,
 listing_id bigint references public.listings(id) on delete set null,
 notification_payload jsonb, notification_sent_at timestamptz, notification_provider_id text,
 notification_attempts integer not null default 0, notification_first_attempt_at timestamptz,
 notification_next_attempt_at timestamptz not null default now(), notification_claim uuid, notification_claim_until timestamptz,
 notification_error text, created_at timestamptz not null default now(),
 unique(host_id,submission_request_id), check(review_note is null or length(review_note)<=1000)
);
create table parkshare_private.host_application_attempts (
 host_id uuid not null references public.profiles(id), request_id uuid not null,
 application_id uuid not null references parkshare_private.host_listing_applications(id),
 payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'), rejection text check(length(rejection)<=500),
 created_at timestamptz not null default now(),primary key(host_id,request_id)
);
alter table parkshare_private.host_application_attempts enable row level security;
revoke all on parkshare_private.host_application_attempts from public,anon,authenticated;
grant all on parkshare_private.host_application_attempts to service_role;
alter table parkshare_private.host_listing_applications enable row level security;
revoke all on parkshare_private.host_listing_applications from public,anon,authenticated;
grant all on parkshare_private.host_listing_applications to service_role;
create index host_applications_pending on parkshare_private.host_listing_applications(status,submitted_at);
create index host_applications_owner on parkshare_private.host_listing_applications(host_id,created_at);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('host-ownership-documents','host-ownership-documents',false,5242880,array['application/pdf','image/jpeg','image/png','image/webp']);

alter table public.listings add column host_application_id uuid unique references parkshare_private.host_listing_applications(id);
-- Browser clients create applications, never public listings directly.
revoke insert on public.listings from anon,authenticated;
create function public.enforce_host_listing_approval() returns trigger language plpgsql set search_path='' as $fn$
declare application parkshare_private.host_listing_applications%rowtype;
begin
 if TG_OP='UPDATE' then
   if NEW.host_application_id is distinct from OLD.host_application_id or NEW.host_id is distinct from OLD.host_id then
     raise exception using errcode='P0071',message='Listing ownership and approval cannot be reassigned';
   end if;
   if OLD.host_application_id is not null and (NEW.address is distinct from OLD.address or NEW.lat is distinct from OLD.lat or NEW.lng is distinct from OLD.lng) then
     raise exception using errcode='P0071',message='Submit a new application to change an approved property location';
   end if;
   return NEW;
 end if;
 if NEW.host_application_id is null then raise exception using errcode='P0071',message='Staff approval is required before a new listing can go live';end if;
 select * into application from parkshare_private.host_listing_applications where id=NEW.host_application_id for update;
 if not found or application.status<>'approved' or application.reviewed_by is null or application.host_id<>NEW.host_id or application.listing_id is not null then
   raise exception using errcode='P0071',message='A matching staff-approved application is required';
 end if;
 if (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(NEW)) where key in ('host_id','title','address','price','description','features','spaces','photos','img','spots','availability','lat','lng','time_zone')) is distinct from application.listing_payload then
   raise exception using errcode='P0071',message='Listing details must match the approved application';
 end if;
 return NEW;
end $fn$;
create trigger require_host_listing_approval before insert or update of host_application_id,host_id,address,lat,lng on public.listings for each row execute function public.enforce_host_listing_approval();
revoke all on function public.enforce_host_listing_approval() from public,anon,authenticated;
grant execute on function public.enforce_host_listing_approval() to service_role;

create function public.host_listing_application(p_action text,p_actor_id uuid,p_application_id uuid default null,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql set search_path='' as $fn$
declare a parkshare_private.host_listing_applications%rowtype; attempt parkshare_private.host_application_attempts%rowtype; reviewer boolean; saved public.listings%rowtype; candidate public.listings%rowtype; new_id uuid; ext text; result jsonb;
begin
 select (raw_app_meta_data->>'parkshare_staff'='true' or raw_app_meta_data->>'parkshare_host_approver'='true'
   or (lower(email)='info@myparkshare.ca' and email_confirmed_at is not null)) and deleted_at is null and (banned_until is null or banned_until<=now())
 into reviewer from auth.users where id=p_actor_id;
 reviewer:=coalesce(reviewer,false);
 if p_action in ('list','get') then
   if coalesce((p_data->>'review')::boolean,false) and not reviewer then raise exception using errcode='42501',message='Staff review access required';end if;
   if p_action='get' then
     select * into a from parkshare_private.host_listing_applications where id=p_application_id;
     if not found or not (a.host_id=p_actor_id or (reviewer and a.status<>'draft')) then raise exception using errcode='42501',message='Application unavailable';end if;
     return to_jsonb(a)||(select jsonb_build_object('host_name',p.name,'host_email',u.email) from public.profiles p join auth.users u on u.id=p.id where p.id=a.host_id);
   end if;
   select coalesce(jsonb_agg(item),'[]'::jsonb) into result from (
     select jsonb_build_object('id',x.id,'status',x.status,'address',x.address,'submitted_at',x.submitted_at,'review_note',x.review_note,'listing_id',x.listing_id,
       'notification_sent_at',x.notification_sent_at,'notification_error',x.notification_error) as item
     from parkshare_private.host_listing_applications x
     where x.status<>'draft' and (case when coalesce((p_data->>'review')::boolean,false) then reviewer and (p_data->>'status'='all' or x.status=coalesce(p_data->>'status','submitted')) else x.host_id=p_actor_id end)
     order by x.submitted_at asc,x.id limit 50
   ) items;
   return result;
 end if;
 if p_action='start' then
   if not exists(select 1 from public.profiles where id=p_actor_id and role='host') then raise exception using errcode='42501',message='Host account required';end if;
   if (select count(*) from parkshare_private.host_listing_applications where host_id=p_actor_id and created_at>now()-interval '24 hours')>=20 then raise exception using errcode='P0073',message='Too many document upload attempts today. Contact ParkShare for help.';end if;
   if p_data->>'propertyKey' !~ '^[0-9a-f]{64}$' or length(coalesce(p_data->>'address','')) not between 5 and 500 then raise exception using errcode='22023',message='Confirm the property address';end if;
   ext:=case p_data->>'mime' when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else null end;
   if ext is null then raise exception using errcode='22023',message='Unsupported ownership document';end if;
   new_id:=gen_random_uuid();
   insert into parkshare_private.host_listing_applications(id,host_id,property_key,address,document_type,document_path,document_mime,document_size)
   values(new_id,p_actor_id,p_data->>'propertyKey',p_data->>'address',p_data->>'documentType',p_actor_id::text||'/'||new_id::text||'.'||ext,p_data->>'mime',(p_data->>'size')::integer) returning * into a;
   return to_jsonb(a);
 end if;
 select * into a from parkshare_private.host_listing_applications where id=p_application_id for update;
 if not found then raise exception using errcode='42501',message='Application unavailable';end if;
 if p_action in ('confirm','submit') and a.host_id<>p_actor_id then raise exception using errcode='42501',message='Application unavailable';end if;
 if p_action='confirm' then
   if a.status<>'draft' then return to_jsonb(a);end if;
   if not exists(select 1 from storage.objects where bucket_id='host-ownership-documents' and name=a.document_path
     and (metadata->>'size')::bigint=a.document_size and metadata->>'mimetype'=a.document_mime) then raise exception using errcode='22023',message='Upload the ownership document first';end if;
   update parkshare_private.host_listing_applications set document_uploaded_at=coalesce(document_uploaded_at,now()) where id=a.id returning * into a;
   return to_jsonb(a);
 end if;
 if p_action='submit' then
   select * into attempt from parkshare_private.host_application_attempts where host_id=p_actor_id and request_id=(p_data->>'requestId')::uuid;
   if found then
     if attempt.application_id<>a.id or attempt.payload_hash is distinct from p_data->>'hash' then raise exception using errcode='P0061',message='Application request details cannot be changed';end if;
     if attempt.rejection is not null then return jsonb_build_object('rejected',true,'error',attempt.rejection);end if;
   end if;
   if a.status<>'draft' then
     if a.submission_request_id is distinct from (p_data->>'requestId')::uuid or a.payload_hash is distinct from p_data->>'hash' then raise exception using errcode='P0061',message='Submitted application details cannot be changed';end if;
     return to_jsonb(a);
   end if;
   if p_data->>'rejection' is not null then
     insert into parkshare_private.host_application_attempts(host_id,request_id,application_id,payload_hash,rejection)
       values(p_actor_id,(p_data->>'requestId')::uuid,a.id,p_data->>'hash',left(p_data->>'rejection',500));
     return jsonb_build_object('rejected',true,'error',left(p_data->>'rejection',500));
   end if;
   if a.document_uploaded_at is null or a.property_key is distinct from p_data->>'propertyKey' then raise exception using errcode='22023',message='Upload ownership proof for this property before submitting';end if;
   if not exists(select 1 from public.profiles where id=p_actor_id and role='host') or p_data->'listing'->>'host_id' is distinct from p_actor_id::text then raise exception using errcode='42501',message='Host account required';end if;
   if p_data->'notification'->'to' is distinct from '["info@myparkshare.ca"]'::jsonb then raise exception using errcode='22023',message='Invalid application review destination';end if;
   insert into parkshare_private.host_application_attempts(host_id,request_id,application_id,payload_hash)
     values(p_actor_id,(p_data->>'requestId')::uuid,a.id,p_data->>'hash');
   update parkshare_private.host_listing_applications set status='submitted',listing_payload=p_data->'listing',submission_request_id=(p_data->>'requestId')::uuid,payload_hash=p_data->>'hash',
     submitted_at=now(),notification_payload=p_data->'notification' where id=a.id returning * into a;
   return to_jsonb(a);
 end if;
 if p_action='review' then
   if not reviewer then raise exception using errcode='42501',message='Staff review access required';end if;
   if a.status=p_data->>'decision' and a.status in ('approved','rejected') then return to_jsonb(a);end if;
   if a.status<>'submitted' then raise exception using errcode='P0072',message='This application has already been reviewed';end if;
   if p_data->>'decision' not in ('approved','rejected') then raise exception using errcode='22023',message='Choose approve or reject';end if;
   if p_data->>'decision'='rejected' and length(trim(coalesce(p_data->>'note','')))<10 then raise exception using errcode='22023',message='Explain what the Host needs to correct';end if;
   if p_data->>'decision'='approved' and not exists(select 1 from public.profiles where id=a.host_id and role='host' and stripe_onboarding_complete and stripe_charges_enabled and stripe_payouts_enabled and exists(select 1 from auth.users u where u.id=a.host_id and u.deleted_at is null and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now()))) then raise exception using errcode='P0074',message='The Host must finish Stripe setup before approval';end if;
   if p_data->>'decision'='approved' and (a.document_uploaded_at is null or not exists(select 1 from storage.objects where bucket_id='host-ownership-documents' and name=a.document_path)) then
     raise exception using errcode='22023',message='Ownership proof is missing; request a corrected application';
   end if;
   if p_data->>'decision'='approved' and exists(select 1 from jsonb_array_elements_text(a.listing_payload->'photos') as photo(url)
     where not exists(select 1 from storage.objects o where o.bucket_id='listing-photos' and o.name=substring(photo.url from '/listing-photos/(.*)$'))) then
     raise exception using errcode='22023',message='A driveway photo is missing; request a corrected application';
   end if;
   update parkshare_private.host_listing_applications set status=p_data->>'decision',reviewed_by=p_actor_id,reviewed_at=now(),review_note=nullif(trim(p_data->>'note'),'') where id=a.id returning * into a;
   if a.status='approved' then
     select * into candidate from jsonb_populate_record(null::public.listings,a.listing_payload);
     insert into public.listings(host_id,title,address,price,description,features,spaces,photos,img,spots,availability,lat,lng,time_zone,host_application_id)
     values(a.host_id,candidate.title,candidate.address,candidate.price,candidate.description,candidate.features,candidate.spaces,candidate.photos,candidate.img,candidate.spots,candidate.availability,candidate.lat,candidate.lng,candidate.time_zone,a.id) returning * into saved;
     update parkshare_private.host_listing_applications set listing_id=saved.id where id=a.id returning * into a;
   end if;
   return to_jsonb(a);
 end if;
 raise exception using errcode='22023',message='Unknown application action';
end $fn$;
revoke all on function public.host_listing_application(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.host_listing_application(text,uuid,uuid,jsonb) to service_role;

create function public.claim_host_application_notifications(p_application_id uuid default null,p_limit integer default 5)
returns setof jsonb language plpgsql set search_path='' as $fn$
begin
 if p_limit<1 or p_limit>10 then raise exception 'Invalid batch size';end if;
 return query
 with jobs as (select id from parkshare_private.host_listing_applications where notification_payload is not null and notification_sent_at is null
   and (p_application_id is null or id=p_application_id) and notification_attempts<10
   and (notification_first_attempt_at is null or notification_first_attempt_at>now()-interval '23 hours')
   and notification_next_attempt_at<=now() and (notification_claim_until is null or notification_claim_until<=now())
   order by submitted_at limit p_limit for update skip locked)
 update parkshare_private.host_listing_applications a set notification_claim=gen_random_uuid(),notification_claim_until=now()+interval '90 seconds',
   notification_first_attempt_at=coalesce(notification_first_attempt_at,now()),notification_attempts=notification_attempts+1,
   notification_next_attempt_at=now()+least(interval '1 hour',interval '1 minute'*power(2,least(notification_attempts,6)))
 from jobs where a.id=jobs.id returning jsonb_build_object('id',a.id,'claim',a.notification_claim,'payload',a.notification_payload);
end $fn$;
create function public.finish_host_application_notification(p_id uuid,p_claim uuid,p_provider_id text default null,p_error text default null)
returns boolean language plpgsql set search_path='' as $fn$
begin
 update parkshare_private.host_listing_applications set notification_sent_at=case when p_provider_id is not null then now() else null end,
 notification_provider_id=p_provider_id,notification_error=case when p_provider_id is not null then null else left(p_error,100) end,
 notification_claim=null,notification_claim_until=null where id=p_id and notification_claim=p_claim and notification_sent_at is null;
 return FOUND;
end $fn$;
revoke all on function public.claim_host_application_notifications(uuid,integer),public.finish_host_application_notification(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_host_application_notifications(uuid,integer),public.finish_host_application_notification(uuid,uuid,text,text) to service_role;
