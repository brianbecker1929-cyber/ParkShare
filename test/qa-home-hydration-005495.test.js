import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React from 'react';
import {createPublicRenderer} from '../scripts/public-content.mjs';
import {writeRoutePages} from '../scripts/route-pages.mjs';
import {PARKSHARE_ROUTES} from '../src/lib/routes.js';
import {shouldHydrateHomepage} from '../src/lib/homeBootstrap.js';

const project=fileURLToPath(new URL('../',import.meta.url));
const renderer=await createPublicRenderer();
const home=PARKSHARE_ROUTES.find(route=>route.path==='/');
test.after(()=>renderer.close());

test('BUG-005495 homepage hydration accepts ordinary URLs but preserves sensitive return flows and private-route mounts',()=>{
  const ordinary={hasServerMarkup:true,pathname:'/'};
  assert.equal(shouldHydrateHomepage(ordinary),true);
  assert.equal(shouldHydrateHomepage({...ordinary,search:'?utm_source=qa&cachebust=2',hash:'#top'}),true);
  assert.equal(shouldHydrateHomepage({...ordinary,hasServerMarkup:false}),false);
  for(const pathname of ['/parking','/my-bookings','/messages','/host-dashboard','/profile','/reset-password'])
    assert.equal(shouldHydrateHomepage({...ordinary,pathname}),false);
  for(const key of ['message_booking','view_booking','extend_booking','legal','booking_success','booking_cancelled','extension_success','extension_cancelled','stripe_onboarding','code','token_hash','type','access_token','refresh_token','error'])
    assert.equal(shouldHydrateHomepage({...ordinary,search:`?${key}=synthetic`}),false,key);
  assert.equal(shouldHydrateHomepage({...ordinary,hash:'#access_token=synthetic&type=recovery'}),false);
});

test('the built homepage includes the exact stylesheet without a blocking CSS request, while other routes retain theirs on rebuild',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'parkshare-home-css-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const css='.ps-home-v2-hero{color:#0e1b2e}@media(max-width:820px){.ps-home-v2-parker-card{width:220px}}';
  await mkdir(join(directory,'assets'));
  await writeFile(join(directory,'assets/index-fixture.css'),css);
  const template=(await readFile(new URL('../index.html',import.meta.url),'utf8')).replace('</head>','<link rel="stylesheet" crossorigin href="/assets/index-fixture.css"></head>');
  await writeFile(join(directory,'index.html'),template);
  for(let pass=0;pass<2;pass++) {
    await writeRoutePages(directory);
    const html=await readFile(join(directory,'index.html'),'utf8');
    const dom=new JSDOM(html,{runScripts:'outside-only'});
    assert.equal(dom.window.document.querySelector('style[data-home-stylesheet]').textContent,css);
    assert.equal(dom.window.document.querySelector('link[rel="stylesheet"]'),null);
    assert.ok(html.indexOf('data-home-hero-preload') < html.indexOf('data-home-stylesheet'), 'responsive preload stays ahead of inline CSS bytes');
    assert.ok(dom.window.document.querySelector('#root[data-home-hydration] .ps-mascot-home-hero'));
    assert.equal(dom.window.document.querySelectorAll('#root').length,1);
    // Scripting-disabled visitors retain native navigation and readable pages.
    const nojs=new JSDOM(html);
    assert.ok(nojs.window.document.querySelector('noscript #public-document a[href="/parking"]'));
    assert.match(nojs.window.document.querySelector('noscript style').textContent,/#root\[data-home-hydration\].*display:none/);
    for(const path of ['help','profile','my-bookings']) {
      const route=await readFile(join(directory,path,'index.html'),'utf8');
      assert.match(route,/<link rel="stylesheet" crossorigin href="\/assets\/index-fixture.css">/);
      assert.ok(!route.includes('data-home-hydration'));
    }
    dom.window.close();nojs.window.close();
  }
});

// Bundle the actual production main/App entry with synthetic, non-networked
// services. The server markup comes from the real build renderer above.
async function clientBundle() {
  const directory=await mkdtemp(join(project,'node_modules/.cache/home-hydration-'));
  const result=await build({entryPoints:[join(project,'src/main.jsx')],bundle:true,platform:'node',format:'esm',packages:'external',write:false,
    define:{'import.meta.env':'{}'},loader:{'.css':'empty'},plugins:[{name:'synthetic-home-services',setup(b){
      b.onResolve({filter:/supabaseClient(?:\.js)?$/},()=>({path:'services',namespace:'fixture'}));
      b.onResolve({filter:/^@react-google-maps\/api$/},()=>({path:'maps',namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='maps'
        ? 'export function useJsApiLoader(){return {isLoaded:false,loadError:null}};export const GoogleMap=()=>null,OverlayView=()=>null,Rectangle=()=>null,Marker=()=>null;'
        : 'export const supabase={auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};export function updateRecoveryPasswordForAccount(){throw Error("No credential action is allowed in this fixture")}'}));
    }}]});
  const file=join(directory,'client.mjs');await writeFile(file,result.outputFiles[0].text);
  return {directory,file};
}

test('actual production bootstrap hydrates without replacing the hero, then navigation and account controls work',async t=>{
  const {directory,file}=await clientBundle();t.after(()=>rm(directory,{recursive:true,force:true}));
  const {appHtml}=renderer.render(home);
  assert.ok(appHtml,'the server must render App, not a separate lookalike page');
  const dom=new JSDOM(`<div id="root" data-home-hydration="v1">${appHtml}</div>`,{url:'https://qa.example.invalid/',pretendToBeVisual:true,runScripts:'outside-only'});
  const previous={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT,fetch:globalThis.fetch};
  const navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  dom.window.scrollTo=()=>{};
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  globalThis.fetch=async()=>{throw Error('No real HTTP request is permitted in this fixture');};
  const errors=[],originalError=console.error;console.error=(...args)=>{const message=args.map(String).join(' ').slice(0,1200);if(errors.length<50)errors.push(message);};
  let client;
  try {
    const hero=dom.window.document.querySelector('.ps-mascot-home-hero');
    const heading=dom.window.document.querySelector('h1');
    await React.act(async()=>{client=await import(pathToFileURL(file));});
    assert.ok(dom.window.document.querySelector('.ps-mascot-home-hero')===hero,'the initial image node must survive startup');
    assert.ok(dom.window.document.querySelector('h1')===heading,'the initial heading must survive startup');
    assert.deepEqual(errors.filter(line=>/hydration|did not match|server HTML|switched to client rendering/i.test(line.split('\n')[0])),[]);
    const button=label=>[...dom.window.document.querySelectorAll('button')].find(el=>el.textContent.trim()===label);
    await React.act(async()=>{button('Sign in').click();});
    // The deferred account validator is a local dynamic import, never a network request.
    for(let i=0;i<3&&!dom.window.document.querySelector('dialog[aria-label="Sign in or create a ParkShare account"]');i++)
      await React.act(async()=>{await new Promise(resolve=>setImmediate(resolve));});
    assert.ok(dom.window.document.querySelector('dialog[open]'),'hydration must attach the real account handler');
    const close=[...dom.window.document.querySelectorAll('dialog button')].find(el=>el.textContent.trim()==='×'||el.textContent.trim()==='Close');
    assert.ok(close);await React.act(async()=>close.click());
    await React.act(async()=>button('About').click());
    assert.equal(dom.window.location.pathname,'/about');
    assert.ok(!dom.window.document.querySelector('.ps-mascot-home-hero'));
  } finally {
    if(client?.applicationRoot)await React.act(async()=>client.applicationRoot.unmount());
    console.error=originalError;dom.window.close();
    globalThis.window=previous.window;globalThis.document=previous.document;globalThis.fetch=previous.fetch;globalThis.IS_REACT_ACT_ENVIRONMENT=previous.IS_REACT_ACT_ENVIRONMENT;
    if(navigatorDescriptor)Object.defineProperty(globalThis,'navigator',navigatorDescriptor);else delete globalThis.navigator;
  }
});
