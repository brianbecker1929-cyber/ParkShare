// Native PostgreSQL 17 runner for a fresh disposable CI service ONLY.
// Dedicated env name prevents accidentally inheriting a hosted DATABASE_URL.
import pg from 'pg';
import {runInitialBookingRefundProbe} from './qa-initial-booking-refund-probe.mjs';
import {runExtensionSettlementProbe} from './qa-extension-settlement-probe.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { assertLocalRehearsalUrl } from './qa-schema-rehearsal.mjs';
import { runSchemaProbes } from './qa-schema-probes.mjs';
import { runCompleteQaReleaseProbe } from './qa-complete-release-probe.mjs';
import { runPhotoCleanupProbe } from './qa-photo-cleanup-probe.mjs';
import {runListingPublicationProbe} from './qa-listing-publication-probe.mjs';
import {runListingTimezoneProbe} from './qa-listing-timezone-probe.mjs';
import {runPublicParkingProbe} from './qa-public-parking-probe.mjs';
import { runRefundLedgerProbe } from './qa-refund-ledger-probe.mjs';

const raw=process.env.QA_SCHEMA_REHEARSAL_DATABASE_URL;
assert.ok(raw,'Set QA_SCHEMA_REHEARSAL_DATABASE_URL to LOCAL disposable PostgreSQL 17 /parkshare_test');
assertLocalRehearsalUrl(raw); // BEFORE connecting or executing any reset.
const client=new pg.Client({connectionString:raw,connectionTimeoutMillis:5000});
const report={checks:[],migrations:[],runtime:'native PostgreSQL 17 CI service',
  sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()};
try {
  await client.connect();
  assert.equal((await client.query('SELECT current_database() db')).rows[0].db,'parkshare_test');
  const db={query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql)};
  await runSchemaProbes(db,report);
  await runCompleteQaReleaseProbe(db,report);
  await runPhotoCleanupProbe(db,report);
  await runRefundLedgerProbe(db,report);
  await runPublicParkingProbe(db,report);
  await runListingTimezoneProbe(db,report);
  await runListingPublicationProbe(db,report,async()=>{const peer=new pg.Client({connectionString:raw,connectionTimeoutMillis:5000});await peer.connect();return peer;});
  await runExtensionSettlementProbe(db,report);
  await runInitialBookingRefundProbe(db,report);
  assert.equal(report.findings?.length??0,0,'Unresolved release findings; inspect rehearsal report');
  console.log(`PASS: ${report.checks.length} full-schema checks; ${report.migrations.length} proposals installed.`);
} catch(e) {
  report.error={code:e.code??null,message:e.message};
  console.error('Full-schema rehearsal FAILED:',e.message);
  process.exitCode=1;
} finally {
  await writeFile('qa-schema-rehearsal-results.json',JSON.stringify(report,null,2)+'\n');
  await client.end();
}
