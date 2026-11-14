import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';

const raw = readFileSync(new URL('../api/send-payment-alerts.js', import.meta.url), 'utf8');
const source = raw.slice(raw.indexOf('export default async function handler'))
  .replace('export default async function handler', 'return async function handler');
function fixture({secret = 'synthetic_secret', result = {enabled: true, accepted: 0, failed: 0}, error = false} = {}) {
  const calls = [], db = {};
  const drainPaymentAlerts = async args => {calls.push(args);if (error) throw new Error('DO_NOT_SEND');return result;};
  const handler = new Function('process','timingSafeEqual','supabaseAdmin','drainPaymentAlerts',source)
    ({env:{CRON_SECRET:secret}},timingSafeEqual,db,drainPaymentAlerts);
  return {calls, async run({method = 'GET', auth = 'Bearer synthetic_secret'} = {}) {
    const headers = {}, res = {setHeader(k,v){headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
    await handler({method,headers:{authorization:auth}},res);return {...res,headers};
  }};
}
test('alert drain rejects unsupported methods and invalid credentials before reading the queue',async()=>{
  for(const [request,status] of [[{method:'POST'},405],[{auth:''},401],[{auth:'Bearer wrong'},401]]) {
    const f=fixture();assert.equal((await f.run(request)).code,status);assert.equal(f.calls.length,0);
  }
  const f=fixture({secret:''});assert.equal((await f.run()).code,503);assert.equal(f.calls.length,0);
});
test('authorized drain fails closed when disabled, unconfigured or unavailable',async()=>{
  for(const options of [{result:{enabled:false,reason:'disabled'}},{error:true},{result:{enabled:true,failed:1}}]) {
    const f=fixture(options),res=await f.run();assert.equal(res.code,503);assert.equal(f.calls.length,1);
    assert.doesNotMatch(JSON.stringify(res.body),/DO_NOT_SEND|synthetic_secret/);
  }
});
test('authorized email-only worker returns its actual counts without caching',async()=>{
  const f=fixture({result:{enabled:true,accepted:1,pending:2,blocked:1,busy:0,failed:0}}),res=await f.run();
  assert.equal(res.code,200);assert.equal(res.headers['Cache-Control'],'private, no-store');
  assert.equal(res.body.accepted,1);assert.equal(f.calls.length,1);
});
