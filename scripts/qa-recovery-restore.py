"""Guarded QA-only logical restore. Credentials and row data never enter logs."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
from urllib.parse import parse_qsl, unquote, urlsplit

SOURCE = 'biydlfekindgaslgktsx'
TARGET = 'heqxirlsorcztsawaldg'
CLI_VERSION = '2.122.0'
PG_IMAGE = 'postgres:17.6-bookworm'
SCHEMAS = ('public', 'parkshare_private', 'qa_release_backup_20261019')
phase = 'initialization'


def validate_url(value, ref):
    try:
        u = urlsplit(value)
        direct = u.hostname == f'db.{ref}.supabase.co' and unquote(u.username or '') == 'postgres'
        pooled = re.fullmatch(r'aws-\d+-ca-central-1\.pooler\.supabase\.com', u.hostname or '') and unquote(u.username or '') == f'postgres.{ref}'
        options = parse_qsl(u.query, keep_blank_values=True)
        if not (u.scheme in ('postgres', 'postgresql') and (direct or pooled)
                and u.port in (None, 5432) and u.path == '/postgres'
                and u.password and '[' not in unquote(u.password)
                and not u.fragment and not any(c in value for c in '\r\n\x00')
                and len(options) <= 1
                and all(k == 'sslmode' and v in ('require', 'verify-ca', 'verify-full') for k, v in options)):
            raise ValueError
        return value + ('' if options else '?sslmode=require')
    except (ValueError, TypeError):
        raise ValueError(f'A credentialed SSL session/direct URL for the fixed project {ref} is required.') from None


def checked_run(args, **kwargs):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=kwargs.pop('timeout', 900), **kwargs)
    if result.returncode:
        # psql context can contain private COPY rows. Only expose a SQLSTATE.
        error = (result.stderr or b'').decode(errors='replace')
        match = re.search(r'(?:ERROR|FATAL):\s+([0-9A-Z]{5})\b', error)
        code = f' SQLSTATE {match.group(1)}.' if match else ''
        raise RuntimeError(f'{phase} failed.{code} No credential or SQL row details are logged.')
    return result.stdout


def psql(url, sql=None, files=None, readonly=False, transaction=False):
    u = urlsplit(url)
    env = os.environ.copy()
    env.update(PGHOST=u.hostname, PGPORT=str(u.port or 5432), PGUSER=unquote(u.username),
               PGPASSWORD=unquote(u.password), PGDATABASE='postgres',
               PGSSLMODE=dict(parse_qsl(u.query)).get('sslmode', 'require'),
               PGCONNECT_TIMEOUT='25', PGOPTIONS='-c statement_timeout=120000' + (' -c default_transaction_read_only=on' if readonly else ''))
    command = ['docker', 'run', '--rm', '--network', 'host', '-i']
    for name in ('PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE', 'PGCONNECT_TIMEOUT', 'PGOPTIONS'):
        command += ['-e', name]
    root = Path(os.environ['QA_RECOVERY_RESTORE_DIR']).resolve()
    command += ['-v', f'{root}:/restore:ro', PG_IMAGE, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate']
    if transaction:
        command.append('--single-transaction')
    for path in files or []:
        command += ['--file', '/restore/' + str(Path(path).resolve().relative_to(root))]
    return checked_run(command, env=env, input=sql.encode() if sql is not None else b'').decode()


EMPTY_SQL = """
SELECT json_build_object(
 'application_tables',(SELECT count(*) FROM pg_tables WHERE schemaname IN ('public','parkshare_private','qa_release_backup_20261019')),
 'auth_users',(SELECT count(*) FROM auth.users),
 'buckets',(SELECT count(*) FROM storage.buckets),
 'objects',(SELECT count(*) FROM storage.objects));
"""

GUARD_SQL = """
SELECT pg_advisory_xact_lock(563208572384);
DO $guard$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname IN ('public','parkshare_private','qa_release_backup_20261019'))
   OR EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM storage.buckets)
   OR EXISTS (SELECT 1 FROM storage.objects) THEN
  RAISE EXCEPTION 'Replacement is not empty; restore refused';
 END IF;
END $guard$;
SET statement_timeout = 0;
"""

MANAGED_SQL = """
SELECT 'SET search_path = public, storage, extensions;';
SELECT pg_get_triggerdef(t.oid, true) || ';'
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
 JOIN pg_namespace f ON f.oid=p.pronamespace
 WHERE n.nspname IN ('auth','storage') AND NOT t.tgisinternal
 AND f.nspname IN ('public','parkshare_private') ORDER BY n.nspname,c.relname,t.tgname;
SELECT format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;',
 policyname,schemaname,tablename,permissive,cmd,
 (SELECT string_agg(CASE WHEN r='public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ') FROM unnest(roles) r),
 CASE WHEN qual IS NULL THEN '' ELSE ' USING ('||qual||')' END,
 CASE WHEN with_check IS NULL THEN '' ELSE ' WITH CHECK ('||with_check||')' END)
 FROM pg_policies WHERE schemaname IN ('auth','storage') ORDER BY schemaname,tablename,policyname;
SELECT 'RESET search_path;';
"""

CATALOG_SQL = """
SELECT json_build_object(
 'public_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
 'public_rls_disabled',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity),
 'policies',(SELECT count(*) FROM pg_policies WHERE schemaname IN ('public','auth','storage')),
 'migrations',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'user_functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','parkshare_private') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')),
 'custom_triggers',(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace f ON f.oid=p.pronamespace WHERE NOT t.tgisinternal AND n.nspname IN ('public','parkshare_private','auth','storage') AND f.nspname IN ('public','parkshare_private')));
"""

FOREIGN_KEYS_SQL = """
DO $foreign_keys$
DECLARE c record; invalid boolean;
BEGIN
 FOR c IN
  SELECT fk.conrelid::regclass AS child_table, fk.confrelid::regclass AS parent_table,
    (SELECT string_agg(format('child.%I = parent.%I',ca.attname,pa.attname),' AND ' ORDER BY k.i)
      FROM unnest(fk.conkey,fk.confkey) WITH ORDINALITY AS k(child_att,parent_att,i)
      JOIN pg_attribute ca ON ca.attrelid=fk.conrelid AND ca.attnum=k.child_att
      JOIN pg_attribute pa ON pa.attrelid=fk.confrelid AND pa.attnum=k.parent_att) AS equality,
    (SELECT string_agg(format('child.%I IS NOT NULL',ca.attname),' AND ' ORDER BY k.i)
      FROM unnest(fk.conkey) WITH ORDINALITY AS k(child_att,i)
      JOIN pg_attribute ca ON ca.attrelid=fk.conrelid AND ca.attnum=k.child_att) AS nonnull
   FROM pg_constraint fk JOIN pg_class tbl ON tbl.oid=fk.conrelid
   JOIN pg_namespace ns ON ns.oid=tbl.relnamespace
   WHERE fk.contype='f' AND ns.nspname IN ('public','parkshare_private','auth','storage','qa_release_backup_20261019')
 LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s child WHERE %s AND NOT EXISTS (SELECT 1 FROM %s parent WHERE %s))',
                 c.child_table,c.nonnull,c.parent_table,c.equality) INTO invalid;
  IF invalid THEN RAISE EXCEPTION 'Restore foreign-key relationship mismatch'; END IF;
 END LOOP;
END $foreign_keys$;
"""


def copy_counts(path):
    counts = {}
    current = None
    with path.open() as source:
        for line in source:
            if current:
                if line.rstrip('\n') == '\\.':
                    current = None
                else:
                    counts[current] += 1
            elif line.startswith('COPY '):
                name = line[5:].split(' (', 1)[0]
                if not re.fullmatch(r'"[a-zA-Z_0-9]+"\."[a-zA-Z_0-9]+"', name):
                    raise RuntimeError('Unexpected COPY identifier; restore refused.')
                if name in counts:
                    raise RuntimeError('Repeated COPY target; restore refused.')
                current = name
                counts[current] = 0
    if current:
        raise RuntimeError('Unterminated COPY data; restore refused.')
    return counts


def count_sql(counts):
    return '\nUNION ALL\n'.join(f"SELECT '{name}' AS relation_name, count(*)::bigint AS row_count FROM {name}" for name in counts) + ';'


def source_counts(url, counts):
    out = psql(url, count_sql(counts), readonly=True)
    return {name: int(n) for name, n in (line.rsplit('|', 1) for line in out.splitlines() if line)}


def write(path, content):
    path.write_text(content)
    path.chmod(0o600)


def prepare(source, target, root):
    global phase
    phase = 'target connection and empty-database check'
    empty = json.loads(psql(target, EMPTY_SQL, readonly=True))
    if any(empty.values()):
        raise RuntimeError('Replacement already contains application data; restore refused.')
    phase = 'source logical export'
    base = ['npm', 'exec', '--yes', f'--package=supabase@{CLI_VERSION}', '--', 'supabase', 'db', 'dump', '--db-url', source]
    exports = (
        ('roles.sql', ['--role-only']), ('schema.sql', []),
        ('data.sql', ['--data-only','--use-copy','-x','storage.buckets_vectors','-x','storage.vector_indexes']),
        ('history_schema.sql', ['--schema','supabase_migrations']),
        ('history_data.sql', ['--data-only','--use-copy','--schema','supabase_migrations']))
    for name, flags in exports:
        phase = 'source export ' + name
        checked_run(base + flags + ['--file', str(root/name)])
        if not (root/name).stat().st_size:
            raise RuntimeError('Empty export; restore refused.')
    phase = 'managed customization export'
    write(root/'managed.sql', psql(source, MANAGED_SQL, readonly=True))
    expected = copy_counts(root/'data.sql') | copy_counts(root/'history_data.sql')
    phase = 'source snapshot row-count verification'
    if source_counts(source, expected) != expected:
        raise RuntimeError('Source changed during export; restore refused.')
    catalog = json.loads(psql(source, CATALOG_SQL, readonly=True))
    if catalog['public_rls_disabled']:
        raise RuntimeError('Source has exposed public tables without RLS; restore refused.')
    # Platform-owned role privileges are managed by Supabase, not cloned.
    roles = (root/'roles.sql').read_text()
    write(root/'restore_roles.sql', '\n'.join(line for line in roles.splitlines()
          if not line.startswith('GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";'))+'\n')
    write(root/'guard.sql', GUARD_SQL)
    write(root/'replica.sql', 'SET session_replication_role = replica;\nSET statement_timeout = 0;\n')
    write(root/'origin.sql', 'SET session_replication_role = origin;\nSET statement_timeout = 0;\n')
    # Verification is part of the same restore transaction; a mismatch rolls back DDL/data.
    checks = []
    for name, count in expected.items():
        checks.append(f"IF (SELECT count(*) FROM {name}) <> {count} THEN RAISE EXCEPTION 'Restore row-count mismatch'; END IF;")
    checks.append("IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity) THEN RAISE EXCEPTION 'Public RLS missing'; END IF;")
    catalog_literal = json.dumps(catalog).replace("'", "''")
    catalog_query = CATALOG_SQL.strip().removesuffix(';')
    checks.append(f"IF ({catalog_query})::jsonb IS DISTINCT FROM '{catalog_literal}'::jsonb THEN RAISE EXCEPTION 'Restore catalog mismatch'; END IF;")
    write(root/'verify.sql', 'DO $verify$ BEGIN\n'+'\n'.join(checks)+'\nEND $verify$;\n'+FOREIGN_KEYS_SQL+'\nNOTIFY pgrst, \'reload schema\';\n')
    manifest = {'source_project':SOURCE,'target_project':TARGET,'exported_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'expected_counts':expected,'source_catalog':catalog,'storage_file_bytes_included':False,
                'files':{name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
                         for name in [n for n,_ in exports]+['managed.sql','restore_roles.sql','guard.sql','replica.sql','origin.sql','verify.sql']
                         for p in [root/name]}}
    write(root/'manifest.json', json.dumps(manifest,indent=2))
    phase = 'pre-restore checkpoint encryption'
    with tarfile.open(root/'checkpoint.tar.gz','w:gz') as archive:
        for name in list(manifest['files'])+['manifest.json']:
            archive.add(root/name,arcname=name)
    cert = Path(__file__).resolve().parent.parent/'docs/qa-recovery/backup-recipient-public.pem'
    checked_run(['openssl','cms','-encrypt','-binary','-aes-256-cbc','-in',str(root/'checkpoint.tar.gz'),
                 '-out',str(root/'pre-restore-checkpoint.cms'),'-outform','DER',str(cert)])
    print('Both fixed QA credentials connect. Target is empty. Encrypted pre-restore checkpoint prepared.')


def restore(source, target, root):
    global phase
    phase = 'checkpoint integrity verification'
    manifest = json.loads((root/'manifest.json').read_text())
    if manifest['source_project'] != SOURCE or manifest['target_project'] != TARGET or not (root/'pre-restore-checkpoint.cms').stat().st_size:
        raise RuntimeError('Checkpoint identity invalid; restore refused.')
    for name, item in manifest['files'].items():
        p = root/name
        if p.stat().st_size != item['bytes'] or hashlib.sha256(p.read_bytes()).hexdigest() != item['sha256']:
            raise RuntimeError('Checkpoint checksum mismatch; restore refused.')
    phase = 'atomic target restore'
    files = ['guard.sql','restore_roles.sql','schema.sql','replica.sql','data.sql',
             'history_schema.sql','history_data.sql','origin.sql','managed.sql','verify.sql']
    psql(target, files=[root/name for name in files], transaction=True)
    phase = 'post-restore verification'
    actual = source_counts(target, manifest['expected_counts'])
    catalog = json.loads(psql(target, CATALOG_SQL, readonly=True))
    passed = actual == manifest['expected_counts'] and catalog == manifest['source_catalog']
    report = {'source_project':SOURCE,'target_project':TARGET,'verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'row_counts_match':actual == manifest['expected_counts'],'catalog_matches':catalog == manifest['source_catalog'],
              'row_counts':actual,'target_catalog':catalog,'source_catalog':manifest['source_catalog'],
              'application_cutover_performed':False,'storage_file_bytes_verified':False,'application_end_to_end_verified':False}
    write(root/'restore-verification.json',json.dumps(report,indent=2))
    if not passed:
        raise RuntimeError('Post-restore catalog/counts differ; target retained for review. No application cutover.')
    print('Target restore committed. All exported table counts, catalog counts and public RLS checks match. Application cutover remains pending.')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        source = validate_url(os.environ.get('QA_RECOVERY_SOURCE_DATABASE_URL',''), SOURCE)
        target = validate_url(os.environ.get('QA_RECOVERY_TARGET_DATABASE_URL',''), TARGET)
        root = Path(os.environ['QA_RECOVERY_RESTORE_DIR']).resolve()
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if len(sys.argv) != 2 or sys.argv[1] not in ('prepare','restore'):
            raise ValueError('Expected prepare or restore stage.')
        (prepare if sys.argv[1]=='prepare' else restore)(source,target,root)
    except Exception as error:
        if isinstance(error,(ValueError,RuntimeError)):
            print(str(error),file=sys.stderr)
        else:
            print(f'{phase} failed ({type(error).__name__}); no credentials or row data logged.',file=sys.stderr)
        sys.exit(1)
