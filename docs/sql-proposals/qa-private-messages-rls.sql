-- PROPOSAL ONLY: BUG-005119 — private Host-Driver messages.
-- NOT AN APPLIED MIGRATION. Coordinate separately with BetterQA.
-- QA inspected read-only October 17, 2026: 4 messages, all have recipient_id.
-- Historical production MUST be inventoried before any schema rollout.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- The old policy grants listing-wide read eligibility and includes a
-- self-referential subquery to messages, which can recurse under RLS.
DROP POLICY IF EXISTS "Participants can view messages on a listing they're involved in" ON public.messages;
DROP POLICY IF EXISTS "Authenticated users can send messages" ON public.messages;
DROP POLICY IF EXISTS "Messages readable only by sender and recipient" ON public.messages;

-- Only the two actual message parties, not everyone who contacted a Host.
CREATE POLICY "Messages readable only by sender and recipient"
ON public.messages FOR SELECT TO authenticated
USING (
  sender_id = (SELECT auth.uid())
  OR recipient_id = (SELECT auth.uid())
);

-- An accidentally broad permissive policy must not reopen other threads.
DROP POLICY IF EXISTS "Message reads require actual participation" ON public.messages;
CREATE POLICY "Message reads require actual participation"
ON public.messages AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  sender_id = (SELECT auth.uid())
  OR recipient_id = (SELECT auth.uid())
);

-- Message creation and recipient selection take place ONLY in the server
-- /api/messages handler, which derives sender ID from the verified JWT and
-- verifies that Host replies target an existing conversation/booking.
REVOKE ALL PRIVILEGES ON TABLE public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages TO service_role;

CREATE INDEX IF NOT EXISTS messages_sender_id_recent_idx
  ON public.messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_recipient_id_recent_idx
  ON public.messages(recipient_id, created_at DESC);

COMMIT;

-- BEFORE DEPLOYING this proposal:
-- 1. Read-only inventory of messages with recipient_id IS NULL in QA AND production.
-- 2. Reconcile historical participant identity before access-control cutover.
-- 3. Verify Supabase service_role still has insert/list permissions.
-- 4. Verify authenticated direct POST fails (403), but authenticated
--    API message POST/GET succeeds for appropriate parties.
-- 5. Test anonymous, Driver A, Driver B, Host and unrelated Host via REST.
-- 6. Do not deploy before coordinated BetterQA test window.

