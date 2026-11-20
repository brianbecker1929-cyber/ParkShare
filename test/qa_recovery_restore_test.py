import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('restore', pathlib.Path(__file__).parents[1]/'scripts/qa-recovery-restore.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RecoveryGuards(unittest.TestCase):
    def url(self, ref, password='synthetic123', port=5432):
        return f'postgresql://postgres.{ref}:{password}@aws-1-ca-central-1.pooler.supabase.com:{port}/postgres'

    def test_exact_source_and_target_accepted(self):
        for ref in (module.SOURCE,module.TARGET):
            self.assertTrue(module.validate_url(self.url(ref),ref).endswith('?sslmode=require'))

    def test_source_target_swap_and_production_rejected(self):
        for ref in (module.SOURCE,'oyxrussraxjgqwzpwyca'):
            with self.assertRaises(ValueError): module.validate_url(self.url(ref),module.TARGET)
        with self.assertRaises(ValueError): module.validate_url(self.url(module.TARGET),module.SOURCE)

    def test_unsafe_connection_options_rejected(self):
        base=self.url(module.TARGET)
        for bad in (self.url(module.TARGET,port=6543),self.url(module.TARGET,password='[YOUR-PASSWORD]'),
                    base+'?sslmode=disable',base+'?options=-c%20jit=true',base+'#fragment',base+'\n',
                    base.replace('pooler.supabase.com','example.com'),base.replace('/postgres','/otherdb')):
            with self.assertRaises(ValueError):module.validate_url(bad,module.TARGET)

    def test_copy_counts_handle_nulls_escaped_newlines_and_empty_tables(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'data.sql'
            p.write_text('COPY "public"."profiles" ("id", "name") FROM stdin;\n1\tname\\nline\n2\t\\N\n\\.\nCOPY "public"."events" ("id") FROM stdin;\n\\.\n')
            self.assertEqual(module.copy_counts(p),{'"public"."profiles"':2,'"public"."events"':0})

    def test_truncated_or_unexpected_copy_data_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/'data.sql'
            for value in ('COPY "public"."profiles" ("id") FROM stdin;\n1\n','COPY untrusted.identifier (id) FROM stdin;\n\\.\n'):
                p.write_text(value)
                with self.assertRaises(RuntimeError):module.copy_counts(p)

    def test_errors_do_not_leak_credentials_or_private_rows(self):
        private='private@example.invalid credential-secret'
        result=subprocess.CompletedProcess([],1,b'',('ERROR: 23505\nCONTEXT: '+private).encode())
        with patch.object(module.subprocess,'run',return_value=result):
            with self.assertRaises(RuntimeError) as caught:module.checked_run(['synthetic'])
        self.assertNotIn(private,str(caught.exception))
        self.assertIn('23505',str(caught.exception))

    def test_empty_target_guard_covers_all_application_schemas(self):
        for schema in module.SCHEMAS:self.assertIn(schema,module.GUARD_SQL)
        for relation in ('auth.users','storage.buckets','storage.objects'):self.assertIn(relation,module.GUARD_SQL)


if __name__ == '__main__':unittest.main()
