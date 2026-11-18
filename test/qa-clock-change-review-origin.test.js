import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentAppUrl} from '../api/_deployment-app-url.js';
import {trustedStripeReturnOrigin} from '../api/_trusted-stripe-origin.js';
import {confirmationEmailHtml} from '../api/_email.js';

const review='https://parkshare-qa-clock-change-review-eska-technologies.vercel.app';
const env={VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC',VERCEL_GIT_COMMIT_REF:'fix/bug-005823-clock-change-nov18',APP_URL:'https://accepted-review.invalid',CLOCK_CHANGE_REVIEW_APP_URL:review};
test('only the exact clock-change QA Preview uses its separate URL; missing config fails closed',()=>{
 assert.equal(deploymentAppUrl(env),review);
 assert.equal(trustedStripeReturnOrigin({appUrl:deploymentAppUrl(env),requestHost:'attacker.invalid'}),review);
 for(const change of [{VERCEL_GIT_COMMIT_REF:'fix/bug-005672-005673-recovery-nov12'},{VERCEL_GIT_COMMIT_REF:'qa/recovery-preflight-oct27'},{VERCEL_ENV:'production'},{VERCEL_PROJECT_ID:'another-project'}])assert.equal(deploymentAppUrl({...env,...change}),env.APP_URL);
 assert.throws(()=>deploymentAppUrl({...env,CLOCK_CHANGE_REVIEW_APP_URL:undefined}),/must be configured/);
});
test('actual confirmation email actions stay on the clock-change review without changing the shared APP_URL',()=>{
 const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
 try{
  Object.assign(process.env,env);
  const html=confirmationEmailHtml({bookingId:42,manageReservationUrl:'https://www.myparkshare.ca/?view_booking=42'});
  assert.ok(html.includes(review+'/?view_booking=42'));assert.ok(!html.includes(env.APP_URL));assert.equal(process.env.APP_URL,env.APP_URL);
  delete process.env.CLOCK_CHANGE_REVIEW_APP_URL;
  assert.throws(()=>confirmationEmailHtml({bookingId:42}),/must be configured/);
 }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
