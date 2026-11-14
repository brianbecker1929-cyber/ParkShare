import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/run-payment-alert-integration.mjs',import.meta.url));
for(const [label,actions,url,reason] of [
  ['outside the disposable runner','false','postgresql://postgres:postgres@127.0.0.1:5432/parkshare_test',/requires a disposable GitHub runner/],
  ['a hosted database','true','postgresql://synthetic@example.invalid/parkshare_test',/requires a LOCAL disposable database/],
  ['a different database name','true','postgresql://postgres:postgres@127.0.0.1:5432/production',/requires parkshare_test/],
  ['connection options','true','postgresql://postgres:postgres@127.0.0.1:5432/parkshare_test?sslmode=disable',/Connection options are forbidden/],
]) test(`alert integration refuses ${label} before opening resources`,()=>{
  const result=spawnSync(process.execPath,[script],{env:{PATH:process.env.PATH,GITHUB_ACTIONS:actions,
    PAYMENT_ALERT_INTEGRATION_DATABASE_URL:url},encoding:'utf8',timeout:10_000});
  assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.match(result.stderr,reason);
  assert.doesNotMatch(result.stdout,/PASS:/);
});
