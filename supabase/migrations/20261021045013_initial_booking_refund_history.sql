BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- A paid but rejected checkout is a financial record, never parking entitlement.
ALTER TABLE public.bookings
 ADD COLUMN application_state text NOT NULL DEFAULT 'applied' CHECK(application_state IN ('applied','rejected')),
 ADD COLUMN checkout_rejection_reason text CHECK(checkout_rejection_reason IN ('booking_conflict','payment_reversed')),
 ADD CONSTRAINT bookings_rejected_checkout_no_entitlement CHECK(application_state<>'rejected' OR status NOT IN ('confirmed','completed'));

CREATE FUNCTION public.settle_initial_booking_checkout(p_hold_id uuid,p_booking jsonb,p_payment_reversed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $func$
DECLARE
 b public.bookings%ROWTYPE;
 existing public.bookings%ROWTYPE;
 h public.booking_holds%ROWTYPE;
 listing bigint;
 capacity integer;
 host uuid;
 starts timestamptz;
 intended tstzrange;
 rejected boolean:=false;
 reason text;
BEGIN
 IF jsonb_typeof(p_booking) IS DISTINCT FROM 'object' OR p_payment_reversed IS NULL OR p_hold_id IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout settlement'; END IF;
 b:=jsonb_populate_record(NULL::public.bookings,p_booking);
 IF b.id IS NOT NULL OR b.listing_id IS NULL OR b.renter_id IS NULL OR b.paid_at IS NULL
 OR b.stripe_checkout_session_id IS NULL OR b.stripe_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$'
 OR b.stripe_payment_intent_id IS NULL OR b.stripe_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
 OR b.stripe_charge_id IS NULL OR b.stripe_charge_id !~ '^ch_[A-Za-z0-9_]+$'
 OR b.stripe_connected_account_id IS NULL OR b.stripe_connected_account_id !~ '^acct_[A-Za-z0-9_]+$'
 OR b.total IS NULL OR b.total<0.5 OR b.subtotal IS NULL OR b.service_fee IS NULL
 OR b.subtotal<0 OR b.service_fee<0 OR b.total<>b.subtotal+b.service_fee
 OR b.total*100<>trunc(b.total*100) OR b.subtotal*100<>trunc(b.subtotal*100) OR b.service_fee*100<>trunc(b.service_fee*100)
 OR b.hours IS NULL OR b.hours<=0 OR b.hours>24 OR b.hours*4<>trunc(b.hours*4)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid registered booking payment'; END IF;
 SELECT x.listing_id INTO listing FROM public.booking_holds x WHERE x.id=p_hold_id;
 listing:=coalesce(listing,b.listing_id);
 -- Same listing lock as reservation/extension RPCs, then own hold row lock.
 PERFORM pg_catalog.pg_advisory_xact_lock(listing);
 SELECT * INTO existing FROM public.bookings x WHERE x.stripe_checkout_session_id=b.stripe_checkout_session_id;
 IF FOUND THEN
  IF existing.listing_id IS DISTINCT FROM b.listing_id OR existing.renter_id IS DISTINCT FROM b.renter_id
   OR existing.stripe_payment_intent_id IS DISTINCT FROM b.stripe_payment_intent_id
   OR existing.stripe_charge_id IS DISTINCT FROM b.stripe_charge_id
   OR existing.stripe_connected_account_id IS DISTINCT FROM b.stripe_connected_account_id
   OR existing.total IS DISTINCT FROM b.total
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Checkout payment identity changed'; END IF;
  RETURN jsonb_build_object('applied',false,'refund_required',existing.application_state='rejected','booking',to_jsonb(existing));
 END IF;
 SELECT * INTO h FROM public.booking_holds x WHERE x.id=p_hold_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Registered booking hold missing'; END IF;
 IF h.listing_id IS DISTINCT FROM listing OR h.listing_id IS DISTINCT FROM b.listing_id
 OR h.renter_id IS DISTINCT FROM b.renter_id
 OR h.stripe_checkout_session_id IS DISTINCT FROM b.stripe_checkout_session_id
 OR h.expected_connected_account_id IS DISTINCT FROM b.stripe_connected_account_id
 OR h.expected_total_cents IS DISTINCT FROM (b.total*100)::integer
 OR h.checkout_metadata IS NULL
 OR (h.checkout_metadata->>'hold_id') IS DISTINCT FROM h.id::text
 OR (h.checkout_metadata->>'listing_id') IS DISTINCT FROM b.listing_id::text
 OR (h.checkout_metadata->>'renter_id') IS DISTINCT FROM b.renter_id::text
 OR (h.checkout_metadata->>'connected_account_id') IS DISTINCT FROM b.stripe_connected_account_id
 OR (h.checkout_metadata->>'total_cents')::numeric IS DISTINCT FROM b.total*100
 OR (h.checkout_metadata->>'subtotal_cents')::numeric IS DISTINCT FROM b.subtotal*100
 OR (h.checkout_metadata->>'service_fee_cents')::numeric IS DISTINCT FROM b.service_fee*100
 OR (h.checkout_metadata->>'hours')::numeric IS DISTINCT FROM b.hours
 OR h.ends_at-h.starts_at IS DISTINCT FROM (b.hours::text||' hours')::interval
 OR nullif(upper(trim(h.spot_label)),'') IS DISTINCT FROM nullif(upper(trim(b.spot_label)),'')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Registered booking hold snapshot mismatch'; END IF;
 SELECT greatest(coalesce(l.spaces,1),1),l.host_id INTO capacity,host FROM public.listings l WHERE l.id=listing;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Listing missing'; END IF;
 IF h.checkout_metadata->>'host_id' IS DISTINCT FROM host::text
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Booking Host changed'; END IF;
 IF b.scheduled_starts_at IS NOT NULL AND b.scheduled_starts_at IS DISTINCT FROM h.starts_at
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scheduled booking differs from held instant'; END IF;
 starts:=coalesce(b.scheduled_starts_at,CASE WHEN b.booking_date IS NOT NULL AND b.start_hour IS NOT NULL
  THEN (b.booking_date::date+(b.start_hour::text||' hours')::interval) AT TIME ZONE 'UTC' ELSE b.paid_at END);
 intended:=tstzrange(starts,starts+(b.hours::text||' hours')::interval,'[)');
 rejected:=p_payment_reversed;
 IF rejected THEN reason:='payment_reversed'; END IF;
 IF NOT rejected AND (
   (SELECT count(*) FROM public.bookings x WHERE x.listing_id=listing AND x.status='confirmed' AND x.session_range && intended)
   +(SELECT count(*) FROM public.booking_holds x WHERE x.listing_id=listing AND x.id<>h.id AND x.expires_at>now()
     AND x.starts_at<upper(intended) AND x.ends_at>lower(intended))>=capacity
   OR nullif(trim(b.spot_label),'') IS NOT NULL AND (
    EXISTS(SELECT 1 FROM public.bookings x WHERE x.listing_id=listing AND x.status='confirmed'
     AND upper(trim(x.spot_label))=upper(trim(b.spot_label)) AND x.session_range && intended)
    OR EXISTS(SELECT 1 FROM public.booking_holds x WHERE x.listing_id=listing AND x.id<>h.id AND x.expires_at>now()
     AND upper(trim(x.spot_label))=upper(trim(b.spot_label)) AND x.starts_at<upper(intended) AND x.ends_at>lower(intended))
   )) THEN rejected:=true; reason:='booking_conflict'; END IF;
 LOOP
  BEGIN
   INSERT INTO public.bookings(
    listing_id,renter_id,hours,total,subtotal,service_fee,status,stripe_checkout_session_id,
    stripe_payment_intent_id,stripe_charge_id,stripe_connected_account_id,spot_label,
    booking_date,scheduled_starts_at,property_time_zone,start_hour,end_hour,
    vehicle_profile_id,vehicle_type,vehicle_make,vehicle_model,vehicle_colour,license_plate,
    event_id,event_name,event_category,event_venue_name,event_address,event_lat,event_lng,
    event_starts_at,event_ends_at,event_timezone,event_source,event_source_url,event_access_notes,event_closure_notice,
    paid_at,application_state,checkout_rejection_reason)
   VALUES(b.listing_id,b.renter_id,b.hours,b.total,b.subtotal,b.service_fee,
    CASE WHEN rejected THEN 'payment_failed' ELSE 'confirmed' END,b.stripe_checkout_session_id,
    b.stripe_payment_intent_id,b.stripe_charge_id,b.stripe_connected_account_id,b.spot_label,
    b.booking_date,b.scheduled_starts_at,b.property_time_zone,b.start_hour,b.end_hour,
    b.vehicle_profile_id,b.vehicle_type,b.vehicle_make,b.vehicle_model,b.vehicle_colour,b.license_plate,
    b.event_id,b.event_name,b.event_category,b.event_venue_name,b.event_address,b.event_lat,b.event_lng,
    b.event_starts_at,b.event_ends_at,b.event_timezone,b.event_source,b.event_source_url,b.event_access_notes,b.event_closure_notice,
    b.paid_at,CASE WHEN rejected THEN 'rejected' ELSE 'applied' END,reason) RETURNING * INTO b;
   EXIT;
  EXCEPTION WHEN exclusion_violation THEN
   IF rejected THEN RAISE; END IF;
   rejected:=true; reason:='booking_conflict';
  END;
 END LOOP;
 DELETE FROM public.booking_holds x WHERE x.id=h.id AND x.stripe_checkout_session_id=b.stripe_checkout_session_id;
 RETURN jsonb_build_object('applied',NOT rejected,'refund_required',rejected,'booking',to_jsonb(b));
END;
$func$;
REVOKE ALL ON FUNCTION public.settle_initial_booking_checkout(uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_initial_booking_checkout(uuid,jsonb,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
