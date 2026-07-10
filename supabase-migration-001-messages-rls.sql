-- Run this if you already created the tables from the original supabase-schema.sql.
-- It fixes a bug where a renter couldn't see the host's replies (and vice versa)
-- because the original policy only let you read messages you sent yourself,
-- or messages on a listing you host.

drop policy if exists "Participants can view messages on a listing they're involved in" on messages;

create policy "Participants can view messages on a listing they're involved in"
  on messages for select using (
    auth.uid() = sender_id
    or auth.uid() in (select host_id from listings where listings.id = messages.listing_id)
    or auth.uid() in (select sender_id from messages m2 where m2.listing_id = messages.listing_id)
  );
