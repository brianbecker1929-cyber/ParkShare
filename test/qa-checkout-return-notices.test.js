import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {parseMessageBookingId} from '../src/lib/bookingMessage.js';

const source=await readFile(process.env.QA_CHECKOUT_NOTICE_SOURCE_FILE||new URL('../src/App.jsx',import.meta.url),'utf8');
const C={navy:'#0E1B2E',amber:'#FFC107',amberLight:'#FFF8E1',moss:'#42865b',mossLight:'#eef8ee'};
const start=source.indexOf('function CheckoutReturnNotice(');
const noticeCode=start<0?'function CheckoutReturnNotice(){return null;}':source.slice(start,source.indexOf('// ─── App ─',start));
const compiled=await transform(noticeCode,{loader:'jsx'});
const Notice=new Function('React','C',compiled.code+';return CheckoutReturnNotice;')(React,C);
const oldStart=source.indexOf('          {checkoutBanner === "success" && ('),newStart=source.indexOf('          <CheckoutReturnNotice kind={checkoutBanner}');
const bannerStart=oldStart>=0?oldStart:newStart,bannerEnd=source.indexOf('          {tab === "Browse" &&',bannerStart);
const rendered=await transform('function ReturnBanners({checkoutBanner,connectBanner,onDismiss}){const setCheckoutBanner=onDismiss;const setConnectBanner=onDismiss;return <>'+source.slice(bannerStart,bannerEnd)+'</>;} ',{loader:'jsx'});
const Banners=new Function('React','C','CheckoutReturnNotice',rendered.code+';return ReturnBanners;')(React,C,Notice);
const routeStart=source.indexOf('  useEffect(() => {\n    const params = new URLSearchParams(window.location.search);',source.indexOf('export default function App('));
const routeCode=source.slice(routeStart,source.indexOf('  const handleAuth =',routeStart));
function route(search){const state={checkoutBanner:null,connectBanner:null,screen:null,tab:null,replaced:null},set=key=>value=>{state[key]=value;};let effect;
 const values={useEffect:fn=>{effect=fn;},window:{location:{search,pathname:'/'},history:{replaceState:(_state,_unused,path)=>{state.replaced=path;}}},parseMessageBookingId,
  setCheckoutBanner:set('checkoutBanner'),setConnectBanner:set('connectBanner'),setScreen:set('screen'),setTab:set('tab'),setExtendBookingId:set('extend'),setViewBookingId:set('view'),setLegalSection:set('legal'),navigationAnchorRef:{current:null},getRouteForState:()=>({path:'/terms'}),fetch:()=>{throw Error('Return flags must not initiate a payment or verification call');}};
 new Function(...Object.keys(values),routeCode)(...Object.values(values));effect();return state;
}
function html(state){return renderToStaticMarkup(React.createElement(Banners,{...state,onDismiss:()=>{}})).trim();}
const falseClaims=/Payment received|your booking is confirmed|Additional time purchased|your booking has been extended|no charge was made|Stripe account connected|setup link expired|🎉|✓/i;
const cases=[
 ['booking success flag','?booking_success=1&session_id=cs_SYNTHETIC','/my-bookings',['Refresh bookings','View transactions']],
 ['booking cancellation flag','?booking_cancelled=1','/parking',['View bookings','View transactions']],
 ['extension success flag','?extension_success=1','/my-bookings',['Refresh bookings','View transactions']],
 ['extension cancellation flag','?extension_cancelled=1&extend_booking=42','/my-bookings',['View bookings','View transactions']],
 ['Stripe onboarding return flag','?stripe_onboarding=return','/host-dashboard',['Refresh payout status']],
 ['Stripe onboarding refresh flag','?stripe_onboarding=refresh','/host-dashboard',['Refresh payout status']],
];
for(const [name,url,path,links] of cases)test(name+' cannot establish a payment, fulfilment, charge absence or payout result',()=>{
 const state=route(url),markup=html(state);assert.equal(state.screen,'app');assert.equal(state.replaced,path);assert.doesNotMatch(markup,falseClaims);assert.match(markup,/role="status"/);for(const label of links)assert.ok(markup.includes(label),label);assert.doesNotMatch(markup,/cs_SYNTHETIC/);
});
test('forged, false-valued and conflicting flags still cannot create a paid/extended claim',()=>{
 for(const url of ['?booking_success=false','?booking_success=0&booking_cancelled=1','?extension_success=anything&extension_cancelled=1','?stripe_onboarding=return&booking_success=1','?booking_cancelled=1&session_id=cs_FAKE'])assert.doesNotMatch(html(route(url)),falseClaims);
});
test('ordinary navigation and unknown return kinds show no notice',()=>{
 assert.equal(html(route('')),'');assert.equal(html(route('?stripe_onboarding=unknown')),'');for(const kind of [null,undefined,'unknown','constructor','__proto__'])assert.equal(renderToStaticMarkup(React.createElement(Notice,{kind,onDismiss:()=>{}})),'');
});
test('notice actions use fixed authenticated views and full navigation to refresh saved state',()=>{
 for(const [,url] of cases){const markup=html(route(url));const hrefs=[...markup.matchAll(/href="([^"]+)"/g)].map(m=>m[1]);assert.ok(hrefs.length>0);for(const href of hrefs)assert.ok(['/my-bookings','/transactions','/host-dashboard'].includes(href));assert.doesNotMatch(markup,/session_id|extend_booking|booking_success|javascript:|https:\/\//);}
});
test('each notice is dismissible without changing booking/payment state',()=>{
 function find(element,type){if(!element||typeof element!=='object')return null;if(element.type===type)return element;for(const child of React.Children.toArray(element.props?.children)){const hit=find(child,type);if(hit)return hit;}return null;}
 for(const [,url] of cases){const state=route(url),kind=state.checkoutBanner||state.connectBanner;let dismissed=0;const button=find(Notice({kind,onDismiss:()=>{dismissed++;}}),'button');assert.equal(button.props.type,'button');assert.match(button.props['aria-label'],/Dismiss/);button.props.onClick();assert.equal(dismissed,1);}
});
test('pending booking and extension returns direct users to saved status before another payment',()=>{
 for(const url of ['?booking_success=1','?extension_success=1']){const markup=html(route(url));assert.match(markup,/refresh bookings shortly/);assert.match(markup,/Check Transactions before trying another payment/);assert.doesNotMatch(markup,/href="[^\"]*(?:checkout|create-extend-session)/);}
});
test('message and reservation email links retain their routing and return query flags are stripped',()=>{
 const message=route('?message_booking=42&booking_success=1');assert.equal(message.tab,'Browse');assert.equal(message.checkoutBanner,null);
 const reservation=route('?view_booking=42');assert.equal(reservation.view,'42');assert.equal(reservation.tab,'My Bookings');assert.equal(reservation.replaced,'/my-bookings');
 const extension=route('?extend_booking=42');assert.equal(extension.extend,'42');assert.equal(extension.replaced,'/');
 for(const [,url,path] of cases){assert.equal(route(url).replaced,path);assert.equal(html(route('')),'');}
});
