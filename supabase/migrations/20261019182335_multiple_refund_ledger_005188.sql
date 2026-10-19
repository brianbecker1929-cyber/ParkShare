-- QA-only deployment after disposable-schema rehearsal. No historical backfill
-- or payment action. Each snapshot is independently verified against Stripe.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.bookings,public.booking_extensions IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE refund_migration_guard ON COMMIT DROP AS SELECT
 (SELECT md5(string_agg(to_jsonb(b)::text,',' ORDER BY b.id)) FROM public.bookings b) bookings_digest,
 (SELECT md5(string_agg(to_jsonb(e)::text,',' ORDER BY e.id)) FROM public.booking_extensions e) extensions_digest;
ALTER TABLE public.bookings
 ADD COLUMN refund_total_amount numeric CHECK(refund_total_amount>=0),
 ADD COLUMN refund_pending_amount numeric CHECK(refund_pending_amount>=0),
 ADD COLUMN refund_ledger_revision bigint NOT NULL DEFAULT 0 CHECK(refund_ledger_revision>=0),
 ADD COLUMN refund_reconciled_at timestamptz;
ALTER TABLE public.booking_extensions
 ADD COLUMN refund_total_amount numeric CHECK(refund_total_amount>=0),
 ADD COLUMN refund_pending_amount numeric CHECK(refund_pending_amount>=0),
 ADD COLUMN refund_ledger_revision bigint NOT NULL DEFAULT 0 CHECK(refund_ledger_revision>=0);

CREATE TABLE public.payment_refunds (
 connected_account_id text NOT NULL CHECK(connected_account_id ~ '^acct_[A-Za-z0-9_]+$'),
 livemode boolean NOT NULL,
 refund_id text NOT NULL CHECK(refund_id ~ '^re_[A-Za-z0-9_]+$'),
 booking_id bigint REFERENCES public.bookings(id) ON DELETE RESTRICT,
 extension_id bigint REFERENCES public.booking_extensions(id) ON DELETE RESTRICT,
 payment_intent_id text NOT NULL CHECK(payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
 charge_id text NOT NULL CHECK(charge_id ~ '^ch_[A-Za-z0-9_]+$'),
 currency text NOT NULL CHECK(currency='cad'),
 amount_cents bigint NOT NULL CHECK(amount_cents>0),
 status text NOT NULL CHECK(status IN ('pending','requires_action','succeeded','failed','canceled')),
 failure_reason text,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text NOT NULL CHECK(source_event_id ~ '^evt_[A-Za-z0-9_]+$'),
 reconciled_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(connected_account_id,livemode,refund_id),
 CHECK(num_nonnulls(booking_id,extension_id)=1)
);
CREATE INDEX payment_refunds_booking_idx ON public.payment_refunds(booking_id);
CREATE INDEX payment_refunds_extension_idx ON public.payment_refunds(extension_id);
CREATE INDEX payment_refunds_payment_idx ON public.payment_refunds(connected_account_id,livemode,payment_intent_id);
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_refunds FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.payment_refunds TO service_role;

CREATE SCHEMA IF NOT EXISTS parkshare_private;
REVOKE ALL ON SCHEMA parkshare_private FROM PUBLIC,anon,authenticated;
-- Any cancellation/dispute or legacy financial write invalidates snapshots
-- that were fetched before it. The ledger explicitly advances this revision.
CREATE FUNCTION parkshare_private.refund_revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.refund_ledger_revision=OLD.refund_ledger_revision AND
    (to_jsonb(NEW)-ARRAY['refund_ledger_revision','refund_reconciled_at','hours','session_range']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['refund_ledger_revision','refund_reconciled_at','hours','session_range']) THEN
   NEW.refund_ledger_revision=OLD.refund_ledger_revision+1;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION parkshare_private.refund_revision_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER bookings_refund_revision BEFORE UPDATE ON public.bookings
 FOR EACH ROW EXECUTE FUNCTION parkshare_private.refund_revision_guard();
CREATE TRIGGER extensions_refund_revision BEFORE UPDATE ON public.booking_extensions
 FOR EACH ROW EXECUTE FUNCTION parkshare_private.refund_revision_guard();

CREATE FUNCTION public.reconcile_payment_refunds(
 p_kind text,p_record_id bigint,p_account text,p_payment_intent text,p_charge text,
 p_livemode boolean,p_expected_revision bigint,p_event_id text,p_gross_cents bigint,
 p_charge_refunded_cents bigint,p_refunds jsonb,p_disputed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
 owner_row record; original_id text; legacy record; settled bigint; pending bigint;
 gross numeric; affected integer; owner_count integer;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('booking','extension') OR p_record_id IS NULL OR
    p_account IS NULL OR p_account !~ '^acct_[A-Za-z0-9_]+$' OR
    p_payment_intent IS NULL OR p_payment_intent !~ '^pi_[A-Za-z0-9_]+$' OR
    p_charge IS NULL OR p_charge !~ '^ch_[A-Za-z0-9_]+$' OR p_livemode IS NULL OR
    p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9_]+$' OR
    p_expected_revision IS NULL OR p_expected_revision<0 OR p_gross_cents IS NULL OR p_gross_cents<=0 OR
    p_charge_refunded_cents IS NULL OR p_charge_refunded_cents<0 OR p_disputed IS NULL OR
    jsonb_typeof(p_refunds) IS DISTINCT FROM 'array' OR jsonb_array_length(p_refunds) NOT BETWEEN 1 AND 10000 THEN
   RAISE EXCEPTION 'Invalid refund snapshot' USING ERRCODE='22023';
 END IF;
 IF p_kind='booking' THEN
   SELECT b.id,b.total amount,b.paid_at,b.stripe_charge_id,b.stripe_refund_id,b.refund_ledger_revision
    INTO owner_row FROM public.bookings b WHERE b.id=p_record_id AND b.stripe_connected_account_id=p_account
      AND b.stripe_payment_intent_id=p_payment_intent FOR UPDATE;
 ELSE
   SELECT e.id,e.added_amount amount,e.paid_at,e.stripe_charge_id,e.stripe_refund_id,e.refund_ledger_revision
    INTO owner_row FROM public.booking_extensions e WHERE e.id=p_record_id AND e.stripe_connected_account_id=p_account
      AND e.stripe_payment_intent_id=p_payment_intent FOR UPDATE;
 END IF;
 IF NOT FOUND OR owner_row.paid_at IS NULL OR
    (owner_row.stripe_charge_id IS NOT NULL AND owner_row.stripe_charge_id<>p_charge) THEN
   RAISE EXCEPTION 'Refund payment owner mismatch' USING ERRCODE='22023';
 END IF;
 IF owner_row.refund_ledger_revision<>p_expected_revision THEN
   RAISE EXCEPTION 'Refund snapshot changed concurrently; retrieve and retry' USING ERRCODE='40001';
 END IF;
 SELECT (SELECT count(*) FROM public.bookings b WHERE b.stripe_connected_account_id=p_account AND b.stripe_payment_intent_id=p_payment_intent)
      + (SELECT count(*) FROM public.booking_extensions e WHERE e.stripe_connected_account_id=p_account AND e.stripe_payment_intent_id=p_payment_intent)
 INTO owner_count;
 IF owner_count<>1 THEN RAISE EXCEPTION 'Ambiguous refund payment owner' USING ERRCODE='22023'; END IF;
 gross=owner_row.amount*100;
 IF gross<>p_gross_cents OR gross<>trunc(gross) THEN
   RAISE EXCEPTION 'Refund charge amount mismatch' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_refunds) AS r(refund_id text,amount_cents bigint,status text,created bigint)
    WHERE r.refund_id IS NULL OR r.refund_id !~ '^re_[A-Za-z0-9_]+$' OR r.amount_cents IS NULL OR r.amount_cents<=0 OR r.amount_cents>gross
       OR r.status IS NULL OR r.status NOT IN ('pending','requires_action','succeeded','failed','canceled') OR r.created IS NULL OR r.created<=0)
    OR (SELECT count(DISTINCT r->>'refund_id') FROM jsonb_array_elements(p_refunds) r)<>jsonb_array_length(p_refunds) THEN
   RAISE EXCEPTION 'Invalid individual refund' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(sum(r.amount_cents) FILTER(WHERE r.status='succeeded'),0),
        coalesce(sum(r.amount_cents) FILTER(WHERE r.status IN ('pending','requires_action')),0)
 INTO settled,pending FROM jsonb_to_recordset(p_refunds) AS r(amount_cents bigint,status text);
 IF settled+pending>gross OR p_charge_refunded_cents<settled OR p_charge_refunded_cents>settled+pending THEN
   RAISE EXCEPTION 'Incomplete or inconsistent refund totals' USING ERRCODE='22023';
 END IF;
 -- Never drop an already recorded refund, or silently switch payment/mode.
 IF EXISTS(SELECT 1 FROM public.payment_refunds f
   WHERE (p_kind='booking' AND f.booking_id=p_record_id OR p_kind='extension' AND f.extension_id=p_record_id)
     AND (f.connected_account_id<>p_account OR f.livemode<>p_livemode OR f.payment_intent_id<>p_payment_intent OR f.charge_id<>p_charge
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_refunds) r WHERE r->>'refund_id'=f.refund_id)))
    OR owner_row.stripe_refund_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(p_refunds) r WHERE r->>'refund_id'=owner_row.stripe_refund_id) THEN
   RAISE EXCEPTION 'Existing refund missing or changed identity' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.payment_refunds AS f(connected_account_id,livemode,refund_id,booking_id,extension_id,
   payment_intent_id,charge_id,currency,amount_cents,status,failure_reason,stripe_created_at,source_event_id)
 SELECT p_account,p_livemode,r.refund_id,CASE WHEN p_kind='booking' THEN p_record_id END,
   CASE WHEN p_kind='extension' THEN p_record_id END,p_payment_intent,p_charge,'cad',r.amount_cents,r.status,
   left(r.failure_reason,200),to_timestamp(r.created),p_event_id
 FROM jsonb_to_recordset(p_refunds) AS r(refund_id text,amount_cents bigint,status text,failure_reason text,created bigint)
 ON CONFLICT(connected_account_id,livemode,refund_id) DO UPDATE SET
   status=excluded.status,failure_reason=excluded.failure_reason,source_event_id=excluded.source_event_id,reconciled_at=now()
 WHERE f.booking_id IS NOT DISTINCT FROM excluded.booking_id AND f.extension_id IS NOT DISTINCT FROM excluded.extension_id
   AND f.payment_intent_id=excluded.payment_intent_id AND f.charge_id=excluded.charge_id
   AND f.amount_cents=excluded.amount_cents AND f.stripe_created_at=excluded.stripe_created_at;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>jsonb_array_length(p_refunds) THEN
   RAISE EXCEPTION 'Immutable refund identity changed' USING ERRCODE='22023';
 END IF;
 -- The legacy single-refund fields retain the ORIGINAL reference and its
 -- individual amount/status. New columns hold successful/pending totals.
 original_id=owner_row.stripe_refund_id;
 SELECT r.* INTO legacy FROM jsonb_to_recordset(p_refunds) AS r(refund_id text,amount_cents bigint,status text,failure_reason text,created bigint)
 WHERE original_id IS NULL OR r.refund_id=original_id ORDER BY r.created,r.refund_id LIMIT 1;
 IF p_kind='booking' THEN
   UPDATE public.bookings b SET
    refund_total_amount=settled::numeric/100,refund_pending_amount=pending::numeric/100,
    refund_ledger_revision=p_expected_revision+1,refund_reconciled_at=now(),
    stripe_refund_id=legacy.refund_id,refund_amount=legacy.amount_cents::numeric/100,
    refund_status=legacy.status,refund_failure_reason=left(legacy.failure_reason,200),
    status=CASE WHEN b.status='disputed' OR p_disputed THEN 'disputed'
                WHEN b.status IN ('refunded','cancelled','canceled') THEN b.status
                WHEN settled=gross THEN 'refunded'
                WHEN b.status='partially_refunded' THEN 'confirmed' ELSE b.status END,
    cancelled_at=CASE WHEN settled=gross AND b.status<>'disputed' AND NOT p_disputed THEN coalesce(b.cancelled_at,now()) ELSE b.cancelled_at END
   WHERE b.id=p_record_id;
 ELSE
   UPDATE public.booking_extensions e SET
    refund_total_amount=settled::numeric/100,refund_pending_amount=pending::numeric/100,
    refund_ledger_revision=p_expected_revision+1,refund_reconciled_at=now(),
    stripe_refund_id=legacy.refund_id,refund_amount=legacy.amount_cents::numeric/100,
    refund_status=legacy.status,refund_failure_reason=left(legacy.failure_reason,200),
    charge_amount_refunded=settled::numeric/100,charge_fully_refunded=settled=gross,charge_disputed=e.charge_disputed OR p_disputed
   WHERE e.id=p_record_id;
 END IF;
 RETURN jsonb_build_object('applied',true,'revision',p_expected_revision+1,'settledCents',settled,'pendingCents',pending);
END $$;
REVOKE ALL ON FUNCTION public.reconcile_payment_refunds(text,bigint,text,text,text,boolean,bigint,text,bigint,bigint,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_payment_refunds(text,bigint,text,text,text,boolean,bigint,text,bigint,bigint,jsonb,boolean) TO service_role;
DO $$
DECLARE before_row record; booking_after text; extension_after text;
BEGIN
 SELECT * INTO before_row FROM pg_temp.refund_migration_guard;
 SELECT md5(string_agg((to_jsonb(b)-ARRAY['refund_total_amount','refund_pending_amount','refund_ledger_revision','refund_reconciled_at'])::text,',' ORDER BY b.id))
 INTO booking_after FROM public.bookings b;
 SELECT md5(string_agg((to_jsonb(e)-ARRAY['refund_total_amount','refund_pending_amount','refund_ledger_revision'])::text,',' ORDER BY e.id))
 INTO extension_after FROM public.booking_extensions e;
 IF booking_after IS DISTINCT FROM before_row.bookings_digest OR extension_after IS DISTINCT FROM before_row.extensions_digest THEN
  RAISE EXCEPTION 'Refund migration changed existing payment data';
 END IF;
END $$;
COMMIT;
