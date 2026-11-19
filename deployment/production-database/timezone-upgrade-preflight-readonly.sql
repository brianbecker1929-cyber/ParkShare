-- Engine upgrade preparation only. Catalog definitions and aggregate counts.
-- No schema, financial, scheduler or credential mutation; no customer rows.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH index_keys AS (
  SELECT ns.nspname schema_name, tbl.relname table_name, idx.relname index_name,
    am.amname access_method, oc.opcname operator_class, t.typname input_type,
    ia.atttypmod type_modifier
  FROM pg_index i
  JOIN pg_class idx ON idx.oid=i.indexrelid
  JOIN pg_class tbl ON tbl.oid=i.indrelid
  JOIN pg_namespace ns ON ns.oid=tbl.relnamespace
  JOIN pg_am am ON am.oid=idx.relam
  CROSS JOIN LATERAL unnest(i.indclass::oid[]) WITH ORDINALITY k(opclass,pos)
  JOIN pg_opclass oc ON oc.oid=k.opclass
  JOIN pg_attribute ia ON ia.attrelid=idx.oid AND ia.attnum=k.pos
  JOIN pg_type t ON t.oid=ia.atttypid
  WHERE k.pos<=i.indnkeyatts AND ns.nspname NOT IN ('pg_catalog','information_schema')
), risky_indexes AS (
  SELECT DISTINCT schema_name,table_name,index_name,access_method,operator_class,
    input_type,type_modifier,
    CASE
      WHEN input_type IN ('ltree','_ltree') THEN 'ltree'
      WHEN access_method='gist' AND input_type IN ('float4','float8') THEN 'gist_float'
      WHEN access_method='btree' AND input_type='bpchar' AND type_modifier=-1 THEN 'unbounded_bpchar'
      WHEN operator_class='gist_trgm_ops' THEN 'gist_trigram'
      WHEN access_method='gin' THEN 'gin_review_if_corruption_suspected'
    END reason
  FROM index_keys
  WHERE input_type IN ('ltree','_ltree')
     OR (access_method='gist' AND input_type IN ('float4','float8'))
     OR (access_method='btree' AND input_type='bpchar' AND type_modifier=-1)
     OR operator_class='gist_trgm_ops' OR access_method='gin'
), custom_operators AS (
  SELECT n.nspname schema_name,o.oprname operator_name,
    o.oprrest::regproc::text restrict_estimator,o.oprjoin::regproc::text join_estimator
  FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema')
    AND ((o.oprrest<>0 AND o.oprrest::oid>=10000) OR (o.oprjoin<>0 AND o.oprjoin::oid>=10000))
    AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_operator'::regclass AND d.objid=o.oid AND d.deptype='e')
), reg_columns AS (
  SELECT n.nspname schema_name,c.relname table_name,a.attname column_name,t.typname type_name
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_type t ON t.oid=a.atttypid
  WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p')
    AND a.attnum>0 AND NOT a.attisdropped
    AND t.typname IN ('regclass','regcollation','regconfig','regdictionary','regnamespace','regoper','regoperator','regproc','regprocedure','regrole','regtype')
)
SELECT jsonb_build_object(
  'checked_at',now(),'database',current_database(),'server_version',current_setting('server_version'),
  'database_bytes',pg_database_size(current_database()),
  'extensions',(SELECT jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
  'index_review',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY schema_name,index_name,reason) FROM risky_indexes r),'[]'::jsonb),
  'custom_operators',coalesce((SELECT jsonb_agg(to_jsonb(o)) FROM custom_operators o),'[]'::jsonb),
  'stored_regtype_columns',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM reg_columns c),'[]'::jsonb),
  'non_extension_c_functions',coalesce((SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE l.lanname='c' AND n.nspname NOT IN ('pg_catalog','information_schema') AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')),'[]'::jsonb),
  'replication_slots',coalesce((SELECT jsonb_agg(jsonb_build_object('name',slot_name,'plugin',plugin,'type',slot_type,'active',active)) FROM pg_replication_slots),'[]'::jsonb),
  'subscriptions',(SELECT count(*) FROM pg_subscription),
  'foreign_servers',(SELECT count(*) FROM pg_foreign_server),
  'cron_installed',to_regnamespace('cron') IS NOT NULL,
  'vault_installed',to_regnamespace('vault') IS NOT NULL,
  'invalid_indexes',(SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage') AND (NOT i.indisvalid OR NOT i.indisready)),
  'active_checkout_holds',(SELECT count(*) FROM public.booking_holds WHERE expires_at>now()),
  'retained_checkout_references',(SELECT count(*) FROM public.booking_holds WHERE stripe_checkout_session_id IS NOT NULL),
  'future_confirmed_bookings',(SELECT count(*) FROM public.bookings WHERE status::text='confirmed' AND upper(session_range)>now()),
  'active_connections',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()),
  'prepared_transactions',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()),
  'vancouver_observed_utc',('2026-11-18 10:00'::timestamp AT TIME ZONE 'America/Vancouver') AT TIME ZONE 'UTC',
  'vancouver_correct',('2026-11-18 10:00'::timestamp AT TIME ZONE 'America/Vancouver')='2026-11-18 17:00+00'::timestamptz
) snapshot;
COMMIT;
