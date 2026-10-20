BEGIN;
-- Financial audit rows for rejected payments never confer parking time.
ALTER TABLE public.booking_extensions ADD COLUMN application_state text NOT NULL DEFAULT 'applied'
 CHECK (application_state IN ('applied','rejected'));

CREATE FUNCTION public.record_rejected_booking_extension(
 p_checkout_session_id text, p_payment_intent_id text, p_charge_id text,
 p_connected_account_id text, p_gross_cents integer, p_paid_at timestamptz
) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $func$
DECLARE
 p public.pending_booking_extensions%ROWTYPE;
 b public.bookings%ROWTYPE;
 e public.booking_extensions%ROWTYPE;
 h public.booking_holds%ROWTYPE;
 listing bigint;
BEGIN
 IF p_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$'
 OR p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$' OR p_charge_id !~ '^ch_[A-Za-z0-9_]+$'
 OR p_connected_account_id !~ '^acct_[A-Za-z0-9_]+$'
 OR p_gross_cents IS NULL OR p_gross_cents<=0 OR p_paid_at IS NULL
 OR p_checkout_session_id IS NULL OR p_payment_intent_id IS NULL
 OR p_charge_id IS NULL OR p_connected_account_id IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid rejected extension payment'; END IF;
 -- Same lock order as apply_paid_booking_extension: pending, listing, booking, hold.
 SELECT * INTO p FROM public.pending_booking_extensions x
 WHERE x.stripe_checkout_session_id=p_checkout_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Registered extension missing'; END IF;
 IF p.expected_connected_account_id IS DISTINCT FROM p_connected_account_id
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension account mismatch'; END IF;
 SELECT x.listing_id INTO listing FROM public.bookings x WHERE x.id=p.booking_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Booking missing'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(listing);
 SELECT * INTO b FROM public.bookings x WHERE x.id=p.booking_id FOR UPDATE;
 IF NOT FOUND OR b.listing_id IS DISTINCT FROM listing OR b.renter_id IS DISTINCT FROM p.renter_id
 OR b.stripe_connected_account_id IS DISTINCT FROM p_connected_account_id
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension booking mismatch'; END IF;
 SELECT * INTO e FROM public.booking_extensions x WHERE x.stripe_checkout_session_id=p_checkout_session_id;
 IF FOUND THEN
  IF e.application_state<>'rejected' OR e.booking_id IS DISTINCT FROM p.booking_id
   OR e.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id
   OR e.stripe_charge_id IS DISTINCT FROM p_charge_id
   OR e.stripe_connected_account_id IS DISTINCT FROM p_connected_account_id
   OR e.added_amount IS DISTINCT FROM p_gross_cents::numeric/100
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension already applied or payment identity changed'; END IF;
 ELSE
  INSERT INTO public.booking_extensions(booking_id,added_hours,added_amount,stripe_checkout_session_id,
   stripe_payment_intent_id,stripe_charge_id,stripe_connected_account_id,status,paid_at,application_state)
  VALUES(p.booking_id,p.added_hours,p_gross_cents::numeric/100,p_checkout_session_id,
   p_payment_intent_id,p_charge_id,p_connected_account_id,'payment_failed',p_paid_at,'rejected') RETURNING * INTO e;
 END IF;
 SELECT * INTO h FROM public.booking_holds x WHERE x.id=p.hold_id FOR UPDATE;
 IF FOUND THEN
  IF h.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
   OR h.listing_id IS DISTINCT FROM b.listing_id OR h.renter_id IS DISTINCT FROM p.renter_id
   OR h.ends_at-h.starts_at IS DISTINCT FROM (p.added_hours::text||' hours')::interval
   OR nullif(upper(trim(h.spot_label)),'') IS DISTINCT FROM nullif(upper(trim(b.spot_label)),'')
   OR (h.expected_connected_account_id IS NOT NULL AND h.expected_connected_account_id<>p_connected_account_id)
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension hold mismatch'; END IF;
  DELETE FROM public.booking_holds x WHERE x.id=h.id AND x.stripe_checkout_session_id=p_checkout_session_id;
 END IF;
 -- Retain pending registration for audit and retry. No booking entitlement update.
 RETURN e.id;
END;
$func$;
REVOKE ALL ON FUNCTION public.record_rejected_booking_extension(text,text,text,text,integer,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_rejected_booking_extension(text,text,text,text,integer,timestamptz) TO service_role;

CREATE FUNCTION public.release_unpaid_extension_checkout(p_checkout_session_id text,p_connected_account_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $func$
DECLARE
 p public.pending_booking_extensions%ROWTYPE;
 b public.bookings%ROWTYPE;
 h public.booking_holds%ROWTYPE;
 listing bigint;
BEGIN
 SELECT * INTO p FROM public.pending_booking_extensions x
 WHERE x.stripe_checkout_session_id=p_checkout_session_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p.expected_connected_account_id IS DISTINCT FROM p_connected_account_id
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension account mismatch'; END IF;
 SELECT x.listing_id INTO listing FROM public.bookings x WHERE x.id=p.booking_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Booking missing'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(listing);
 SELECT * INTO b FROM public.bookings x WHERE x.id=p.booking_id FOR UPDATE;
 IF NOT FOUND OR b.listing_id IS DISTINCT FROM listing OR b.renter_id IS DISTINCT FROM p.renter_id
 OR b.stripe_connected_account_id IS DISTINCT FROM p_connected_account_id
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension booking mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_extensions x WHERE x.stripe_checkout_session_id=p_checkout_session_id)
 THEN RETURN false; END IF;
 SELECT * INTO h FROM public.booking_holds x WHERE x.id=p.hold_id FOR UPDATE;
 IF FOUND THEN
  IF h.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
   OR h.listing_id IS DISTINCT FROM b.listing_id OR h.renter_id IS DISTINCT FROM p.renter_id
   OR (h.expected_connected_account_id IS NOT NULL AND h.expected_connected_account_id<>p_connected_account_id)
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension hold mismatch'; END IF;
  DELETE FROM public.booking_holds x WHERE x.id=h.id AND x.stripe_checkout_session_id=p_checkout_session_id;
 END IF;
 DELETE FROM public.pending_booking_extensions x WHERE x.id=p.id AND x.expected_connected_account_id=p_connected_account_id;
 RETURN true;
END;
$func$;
REVOKE ALL ON FUNCTION public.release_unpaid_extension_checkout(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_unpaid_extension_checkout(text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
