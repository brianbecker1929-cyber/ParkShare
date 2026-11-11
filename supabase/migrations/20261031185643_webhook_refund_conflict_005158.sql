-- BUG-005158: PostgREST 14 retries SQLSTATE 40001 inside the same RPC.
-- A stale application revision can never become current by repeating the
-- same arguments. Such requests exhaust the pool and block paid Checkout.
-- Refuse with HTTP 409 instead; the caller/Stripe must obtain a NEW snapshot.
-- Change only this exception. Preserve invoker security, grants and all money
-- validation/locking logic. No booking, refund or payment row is modified.
DO $migration$
DECLARE
  target regprocedure := to_regprocedure('public.reconcile_payment_refunds(text,bigint,text,text,text,boolean,bigint,text,bigint,bigint,jsonb,boolean)');
  definition text;
  previous record;
  updated record;
  old_clause constant text := $old$RAISE EXCEPTION 'Refund snapshot changed concurrently; retrieve and retry' USING ERRCODE='40001';$old$;
  new_clause constant text := $new$RAISE EXCEPTION 'Refund snapshot changed concurrently; retrieve and retry' USING ERRCODE='PT409', DETAIL='refund_snapshot_stale';$new$;
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'Refund reconciliation function is missing'; END IF;
  SELECT proacl, prosecdef, proconfig, proowner INTO previous FROM pg_proc WHERE oid=target;
  IF previous.prosecdef THEN RAISE EXCEPTION 'Expected invoker-only refund reconciliation'; END IF;
  definition := pg_get_functiondef(target);
  IF strpos(definition,new_clause)>0 AND strpos(definition,old_clause)=0 THEN RETURN; END IF;
  IF (length(definition)-length(replace(definition,old_clause,'')))/length(old_clause) <> 1 THEN
    RAISE EXCEPTION 'Refund reconciliation definition changed; review before applying';
  END IF;
  EXECUTE replace(definition,old_clause,new_clause);
  SELECT proacl, prosecdef, proconfig, proowner INTO updated FROM pg_proc WHERE oid=target;
  IF previous IS DISTINCT FROM updated THEN
    RAISE EXCEPTION 'Refund reconciliation permissions/configuration changed';
  END IF;
END
$migration$;
