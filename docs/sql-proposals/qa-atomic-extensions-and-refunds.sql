-- REVIEW-ONLY DRAFT. Do NOT execute on live or BetterQA QA databases.
-- Coordinate an approved migration using "supabase migration new" first.
-- Schema inspected READ-ONLY on ParkShare-QA, October 17, 2026.
BEGIN;

ALTER TABLE public.booking_extensions
 ADD COLUMN IF NOT EXISTS stripe_refund_id text,
 ADD COLUMN IF NOT EXISTS refund_status text,
 ADD COLUMN IF NOT EXISTS refund_amount numeric,
 ADD COLUMN IF NOT EXISTS refund_failure_reason text,
 ADD COLUMN IF NOT EXISTS charge_amount_refunded numeric,
 ADD COLUMN IF NOT EXISTS charge_fully_refunded boolean,
 ADD COLUMN IF NOT EXISTS charge_disputed boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS refund_reconciled_at timestamptz;

-- Invoked only by the service-role webhook after Stripe PaymentIntent validation.
-- Insert and increment are ONE transaction. Failure of either rolls back both.
CREATE OR REPLACE FUNCTION public.apply_paid_booking_extension(
 p_checkout_session_id text, p_booking_id bigint, p_renter_id uuid,
 p_added_hours numeric, p_expected_total_cents integer,
 p_payment_intent_id text, p_charge_id text,
 p_connected_account_id text, p_paid_at timestamptz
) RETURNS TABLE(applied boolean, resulting_hours numeric)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $func$
DECLARE
 p public.pending_booking_extensions%ROWTYPE;
 b public.bookings%ROWTYPE;
 e public.booking_extensions%ROWTYPE;
 v_listing_id bigint;
 v_capacity int;
 v_old_end timestamptz;
 v_new_end timestamptz;
 v_range tstzrange;
 v_spot text;
 v_other_bookings bigint;
 v_other_holds bigint;
BEGIN
 IF nullif(p_checkout_session_id,'') IS NULL
 OR nullif(p_payment_intent_id,'') IS NULL
 OR nullif(p_connected_account_id,'') IS NULL
 OR p_paid_at IS NULL OR p_booking_id IS NULL OR p_renter_id IS NULL
 OR p_expected_total_cents IS NULL OR p_expected_total_cents < 50
 OR p_added_hours IS NULL OR p_added_hours <= 0 OR p_added_hours > 24
 OR (p_added_hours * 4) <> trunc(p_added_hours * 4)
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid extension parameters'; END IF;

 SELECT * INTO p FROM public.pending_booking_extensions x
 WHERE x.stripe_checkout_session_id=p_checkout_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Registered extension missing'; END IF;
 IF p.booking_id <> p_booking_id OR p.renter_id <> p_renter_id
 OR p.added_hours <> p_added_hours
 OR p.expected_total_cents <> p_expected_total_cents
 OR p.expected_connected_account_id <> p_connected_account_id
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Trusted extension snapshot mismatch'; END IF;

 SELECT x.listing_id INTO v_listing_id FROM public.bookings x WHERE x.id=p_booking_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Booking missing'; END IF;
 -- Same listing-scoped lock used by create_booking_hold.
 PERFORM pg_catalog.pg_advisory_xact_lock(v_listing_id);
 SELECT * INTO b FROM public.bookings x WHERE x.id=p_booking_id FOR UPDATE;
 IF NOT FOUND OR b.listing_id<>v_listing_id OR b.renter_id<>p_renter_id
 OR b.stripe_connected_account_id IS DISTINCT FROM p_connected_account_id
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Booking identity mismatch'; END IF;

 -- Idempotency is safe: earlier insert and hours update committed together.
 SELECT * INTO e FROM public.booking_extensions x
 WHERE x.stripe_checkout_session_id=p_checkout_session_id;
 IF FOUND THEN
   IF e.booking_id<>p_booking_id
   OR e.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id
   OR e.stripe_connected_account_id IS DISTINCT FROM p_connected_account_id
   THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Extension identity conflict'; END IF;
   RETURN QUERY SELECT false,b.hours; RETURN;
 END IF;
 IF b.status <> 'confirmed' OR b.session_range IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Reconcile paid extension manually: booking no longer confirmed'; END IF;

 v_old_end:=upper(b.session_range);
 v_new_end:=v_old_end+(p_added_hours::text||' hours')::interval;
 v_range:=tstzrange(v_old_end,v_new_end,'[)');
 v_spot:=nullif(upper(trim(b.spot_label)),'');
 SELECT greatest(coalesce(l.spaces,1),1) INTO v_capacity FROM public.listings l WHERE l.id=v_listing_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Listing missing'; END IF;
 SELECT count(*) INTO v_other_bookings FROM public.bookings x
 WHERE x.listing_id=v_listing_id AND x.id<>p_booking_id
 AND x.status='confirmed' AND x.session_range && v_range;
 SELECT count(*) INTO v_other_holds FROM public.booking_holds h
 WHERE h.listing_id=v_listing_id AND h.expires_at>now()
 AND h.starts_at<v_new_end AND h.ends_at>v_old_end;
 IF v_other_bookings+v_other_holds>=v_capacity
 THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Reconcile paid extension manually: capacity conflict'; END IF;
 IF v_spot IS NOT NULL AND (
 EXISTS (SELECT 1 FROM public.bookings x WHERE x.listing_id=v_listing_id
  AND x.id<>p_booking_id AND x.status='confirmed'
  AND upper(trim(x.spot_label))=v_spot AND x.session_range && v_range)
 OR EXISTS (SELECT 1 FROM public.booking_holds h WHERE h.listing_id=v_listing_id
  AND h.expires_at>now() AND upper(trim(h.spot_label))=v_spot
  AND h.starts_at<v_new_end AND h.ends_at>v_old_end)
 ) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Reconcile paid extension manually: spot conflict'; END IF;

 INSERT INTO public.booking_extensions
 (booking_id,added_hours,added_amount,stripe_checkout_session_id,
  stripe_payment_intent_id,stripe_charge_id,stripe_connected_account_id,status,paid_at)
 VALUES (p_booking_id,p_added_hours,p_expected_total_cents::numeric/100,
 p_checkout_session_id,p_payment_intent_id,p_charge_id,p_connected_account_id,'confirmed',p_paid_at);

 -- Trigger recalculates session_range; existing EXCLUDE constraint rejects
 -- conflicting parking slots. Both writes roll back if either fails.
 UPDATE public.bookings x SET hours=x.hours+p_added_hours
 WHERE x.id=p_booking_id AND x.status='confirmed';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Reconcile paid extension manually: booking changed'; END IF;
 RETURN QUERY SELECT true,b.hours+p_added_hours;
END;
$func$;

REVOKE ALL ON FUNCTION public.apply_paid_booking_extension(text,bigint,uuid,numeric,integer,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paid_booking_extension(text,bigint,uuid,numeric,integer,text,text,text,timestamptz) TO service_role;
COMMIT;
