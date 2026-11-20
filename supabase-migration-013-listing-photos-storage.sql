-- BUG-005135: dedicated public listing-photo bucket with owner-scoped writes.
-- PREPARATION ONLY: Do not apply to any Supabase project until BetterQA
-- approves a QA maintenance window. NEVER run against live production.
--
-- No existing listing rows or photos are modified or removed.
-- Storage public downloads are intentional: public listing photos are
-- visible to Drivers before login. Write operations remain Host-only.

begin;
set local lock_timeout = '5s';

insert into storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types)
values
  ('listing-photos', 'listing-photos', true, 10485760,
   array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The first path segment must be exactly the authenticated Host's UUID.
-- public.profiles.role is stored server-side; client-supplied role cannot
-- grant upload authority. Ordinary Drivers cannot write to the bucket.
create policy "ParkShare Host upload own listing photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
);

-- Authenticated Hosts need SELECT visibility for their own objects to
-- clean up uploads. Public URL downloads work via the bucket's public flag.
create policy "ParkShare Host inspect own listing photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
);

-- Allows cleanup after failed listing creation, but not deleting images
-- belonging to another Host. No UPDATE policy is created: upsert=false.
create policy "ParkShare Host remove own listing photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
);

commit;
