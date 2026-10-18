// Isolated catalog-based schema restore. NEVER accepts a hosted DB connection.
// Captures schema definitions and grants, never QA account or booking rows.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export const fixtureUrl = new URL('../test/database/fixtures/qa-schema-oct18.json', import.meta.url);
export const proposals = [
  'bug-005118-unpaid-hold-rate-limits.sql',
  'qa-atomic-extensions-and-refunds.sql',
  'bug-005156-property-local-canonical-bookings.sql',
  'bug-005136-listing-postal-validation.sql',
  'bug-005137-hourly-price-constraint.sql',
  'bug-005138-future-exceptions.sql',
  'qa-verified-reviews.sql',
  'bug-005183-restrict-public-data-api.sql',
  'qa-account-deletion-booking-retention.sql',
];
export const identifier = value => '"' + value.replaceAll('"', '""') + '"';
export const literal = value => "'" + value.replaceAll("'", "''") + "'";
const qualified = (schema, name) => identifier(schema) + '.' + identifier(name);
const grantee = name => name === 'PUBLIC' ? 'PUBLIC' : identifier(name);

export function assertLocalRehearsalUrl(raw) {
  const url = new URL(raw);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Schema rehearsal requires a LOCAL disposable database');
  assert.equal(decodeURIComponent(url.pathname), '/parkshare_test', 'Schema rehearsal requires parkshare_test');
  assert.equal(url.search, '', 'Connection options are forbidden in rehearsal URL');
}

export async function loadSnapshot() { return JSON.parse(await readFile(fixtureUrl, 'utf8')); }

export async function restoreSnapshot(db, snapshot) {
  const { inventory, structure, code, permissions, extra } = snapshot;
  const exec = async sql => { try { await db.exec(sql); } catch (e) { e.message = `Restore failed: ${sql.slice(0,160)}: ${e.message}`; throw e; } };
  // The caller must validate its connection BEFORE invoking this destructive local reset.
  for (const schema of ['public','auth','storage','extensions']) await exec(`DROP SCHEMA IF EXISTS ${identifier(schema)} CASCADE; CREATE SCHEMA ${identifier(schema)};`);
  await exec('SET search_path=public,extensions; SET check_function_bodies=false;');
  const existingRoles = (await db.query('SELECT rolname FROM pg_roles')).rows.map(r => r.rolname);
  for (const r of inventory.roles) {
    // Built-in roles are engine-version specific; do not invent replacements.
    if (r.name.startsWith('pg_') || r.name==='postgres') continue;
    const action = existingRoles.includes(r.name) ? 'ALTER' : 'CREATE';
    await exec(`${action} ROLE ${identifier(r.name)} NOLOGIN ${r.inherit?'INHERIT':'NOINHERIT'} ${r.bypassrls?'BYPASSRLS':'NOBYPASSRLS'};`);
  }
  for (const m of permissions.memberships) {
    if (m.role.startsWith('pg_') && !existingRoles.includes(m.role)) continue;
    await exec(`GRANT ${identifier(m.role)} TO ${identifier(m.member)};`);
  }
  // pgcrypto is not required: this schema only uses core gen_random_uuid().
  // Vault/statistics/realtime are outside the application migration dependency closure.
  await exec('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public; CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;');
  for (const t of structure.types) {
    assert.equal(t.kind, 'e', 'Unexpected custom domain requires an explicit exporter');
    await exec(`CREATE TYPE ${qualified(t.schema,t.name)} AS ENUM (${t.labels.map(literal).join(',')});`);
  }
  for (const s of structure.sequences.filter(s=>s.dependency_type!=='i')) {
    await exec(`CREATE SEQUENCE ${qualified(s.schema,s.name)} AS ${s.type} START ${s.start} INCREMENT ${s.increment} MINVALUE ${s.min} MAXVALUE ${s.max} CACHE ${s.cache} ${s.cycle?'CYCLE':'NO CYCLE'};`);
  }
  // Build complete tables first, without cross-table constraints, then functions.
  // The only generated expressions in this snapshot depend on built-in functions.
  for (const t of inventory.relations.filter(t=>['r','p'].includes(t.kind))) {
    assert.equal(t.kind,'r','Partitioned tables need an explicit exporter');
    const columns = structure.columns.filter(c=>c.schema===t.schema&&c.table===t.name).map(c=>{
      let definition = `${identifier(c.name)} ${c.type}`;
      if (c.identity) definition += ` GENERATED ${c.identity==='a'?'ALWAYS':'BY DEFAULT'} AS IDENTITY`;
      else if (c.generated) definition += ` GENERATED ALWAYS AS (${c.default}) STORED`;
      else if (c.default!==null) definition += ` DEFAULT ${c.default}`;
      if (c.not_null) definition += ' NOT NULL';
      return definition;
    });
    await exec(`CREATE TABLE ${qualified(t.schema,t.name)} (${columns.join(',\n')});`);
    await exec(`ALTER TABLE ${qualified(t.schema,t.name)} OWNER TO ${identifier(t.owner)};`);
  }
  for (const s of structure.sequences.filter(s=>s.dependency_type==='a')) {
    const owner = inventory.relations.find(t=>t.schema===s.schema&&t.name===s.name).owner;
    await exec(`ALTER SEQUENCE ${qualified(s.schema,s.name)} OWNER TO ${identifier(owner)};`);
    await exec(`ALTER SEQUENCE ${qualified(s.schema,s.name)} OWNED BY ${qualified(s.table_schema,s.table)}.${identifier(s.column)};`);
  }
  for (const f of code.functions) {
    await exec(f.definition);
    await exec(`ALTER FUNCTION ${qualified(f.schema,f.name)}(${f.args}) OWNER TO ${identifier(f.owner)};`);
  }
  for (const type of ['p','u','c','x','f']) for (const c of structure.constraints.filter(c=>c.type===type)) {
    await exec(`ALTER TABLE ${qualified(c.schema,c.table)} ADD CONSTRAINT ${identifier(c.name)} ${c.definition};`);
  }
  for (const index of code.indexes) await exec(index.definition);
  for (const trigger of code.triggers) {
    await exec(trigger.definition);
    const enable = {O:'ENABLE',D:'DISABLE',R:'ENABLE REPLICA',A:'ENABLE ALWAYS'}[trigger.enabled];
    await exec(`ALTER TABLE ${qualified(trigger.schema,trigger.table)} ${enable} TRIGGER ${identifier(trigger.name)};`);
  }
  for (const t of inventory.relations.filter(t=>['r','p'].includes(t.kind))) {
    if(t.rls) await exec(`ALTER TABLE ${qualified(t.schema,t.name)} ENABLE ROW LEVEL SECURITY;`);
    if(t.force_rls) await exec(`ALTER TABLE ${qualified(t.schema,t.name)} FORCE ROW LEVEL SECURITY;`);
  }
  for (const p of inventory.policies) await exec(`CREATE POLICY ${identifier(p.policyname)} ON ${qualified(p.schemaname,p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(grantee).join(',')} ${p.qual?'USING ('+p.qual+')':''} ${p.with_check?'WITH CHECK ('+p.with_check+')':''};`);
  // Revoke implicit PostgreSQL defaults before replaying exact captured grants.
  for (const schema of ['public','auth','storage','extensions']) await exec(`REVOKE ALL ON SCHEMA ${identifier(schema)} FROM PUBLIC;`);
  for (const f of code.functions) await exec(`REVOKE ALL ON FUNCTION ${qualified(f.schema,f.name)}(${f.args}) FROM PUBLIC;`);
  for (const g of permissions.schema_grants) await exec(`GRANT ${g.privilege} ON SCHEMA ${identifier(g.schema)} TO ${grantee(g.grantee)}${g.grantable?' WITH GRANT OPTION':''};`);
  for (const g of permissions.relation_grants) await exec(`GRANT ${g.privilege} ON ${g.kind==='S'?'SEQUENCE':'TABLE'} ${qualified(g.schema,g.name)} TO ${grantee(g.grantee)}${g.grantable?' WITH GRANT OPTION':''};`);
  for (const g of permissions.function_grants) await exec(`GRANT ${g.privilege} ON FUNCTION ${qualified(g.schema,g.name)}(${g.args}) TO ${grantee(g.grantee)}${g.grantable?' WITH GRANT OPTION':''};`);
  for (const g of extra.column_grants) await exec(`GRANT ${g.privilege} (${identifier(g.column)}) ON TABLE ${qualified(g.schema,g.table)} TO ${grantee(g.grantee)}${g.grantable?' WITH GRANT OPTION':''};`);
  const objectTypes = {r:'TABLES',S:'SEQUENCES',f:'FUNCTIONS',T:'TYPES',n:'SCHEMAS'};
  for(const g of permissions.default_grants) await exec(`ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(g.owner)} ${g.schema?'IN SCHEMA '+identifier(g.schema):''} GRANT ${g.privilege} ON ${objectTypes[g.type]} TO ${grantee(g.grantee)}${g.grantable?' WITH GRANT OPTION':''};`);
  // Config row only; no object keys, personal metadata or QA account data.
  for (const b of extra.storage_bucket_configuration) await exec(`INSERT INTO storage.buckets(id,name,public,type) VALUES(${literal(b.id)},${literal(b.id)},${b.public},${literal(b.type)});`);
  await exec('SET check_function_bodies=true;');
}

export async function applyProposals(db, trace=[]) {
  for(const name of proposals) {
    const sql = await readFile(new URL('../docs/sql-proposals/'+name,import.meta.url),'utf8');
    try { await db.exec(sql); trace.push({name,status:'passed'}); }
    catch(e) { await db.exec('ROLLBACK;'); trace.push({name,status:'failed',code:e.code,message:e.message}); throw e; }
  }
  return trace;
}
