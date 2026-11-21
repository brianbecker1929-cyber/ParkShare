import assert from 'node:assert/strict';
import {after,afterEach,before,beforeEach,mock,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {JSDOM} from 'jsdom';
import {transform} from 'esbuild';
import {isListingImageUrl,MAX_LISTING_PHOTOS} from '../src/lib/listingPhotos.js';

const dom=new JSDOM('<!doctype html><body></body>',{url:'https://marketplace.invalid'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
let Gallery,Thumb,roots=[],response,requests;
before(async()=>{
  const source=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
  const built=await transform(source.slice(source.indexOf('function ListingThumb('),source.indexOf('function Badge(')),{loader:'jsx'});
  const values={React,...React,C:{navy:'#0E1B2E',amber:'#ffd000',white:'#fff',concrete:'#eee'},MAX_LISTING_PHOTOS,isListingImageUrl,
    Modal:({children,onClose})=>React.createElement('section',{role:'dialog'},children,React.createElement('button',{onClick:onClose},'Close photo'))};
  ({ListingPhotoGallery:Gallery,ListingThumb:Thumb}=new Function(...Object.keys(values),built.code+';return {ListingPhotoGallery,ListingThumb};')(...Object.values(values)));
});
beforeEach(()=>{
  response={photos:['/api/listing-photo?listingId=7','/api/listing-photo?listingId=7&photo=1']};requests=[];
  mock.method(globalThis,'fetch',async(url,options)=>{requests.push({url,options});return Response.json(response);});
});
afterEach(async()=>{for(const {root,container}of roots){await React.act(()=>root.unmount());container.remove();}roots=[];mock.restoreAll();});
after(()=>{dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
async function mount(element){const container=document.createElement('div');document.body.append(container);const root=createRoot(container);roots.push({root,container});await React.act(async()=>root.render(element));return {root,container};}
const listing=id=>({id:'db-'+id,title:'Driveway at 123 Main Street',img:'/api/listing-photo?listingId='+id,photos:[]});
test('gallery loads before booking, switches photos and opens an enlarged image',async()=>{
  const {container}=await mount(React.createElement(Gallery,{listing:listing(7)}));
  assert.equal(requests[0].url,'/api/listing-photos?listingId=7');assert.equal(requests[0].options.headers,undefined);
  const choose=container.querySelector('[aria-label="View photo 2 of 2"]');assert.ok(choose);
  await React.act(()=>choose.click());assert.equal(container.querySelector('img').getAttribute('src'),response.photos[1]);
  await React.act(()=>container.querySelector('[aria-label="Enlarge driveway photo"]').click());
  assert.equal(container.querySelector('[role="dialog"] img').getAttribute('src'),response.photos[1]);
  await React.act(()=>container.querySelector('[role="dialog"] button').click());assert.equal(container.querySelector('[role="dialog"]'),null);
});
test('thumbnail failure displays the house placeholder and a new image source can load',async()=>{
  const {container,root}=await mount(React.createElement(Thumb,{listing:listing(7)}));
  await React.act(()=>container.querySelector('img').dispatchEvent(new dom.window.Event('error')));
  assert.equal(container.querySelector('img'),null);assert.equal(container.textContent,'🏠');
  await React.act(()=>root.render(React.createElement(Thumb,{listing:listing(8)})));
  assert.equal(container.querySelector('img').getAttribute('src'),listing(8).img);
});
test('an empty gallery leaves a clean placeholder without an enlargement action',async()=>{
  response={photos:[]};const {container}=await mount(React.createElement(Gallery,{listing:listing(7)}));
  assert.equal(container.querySelector('img'),null);assert.equal(container.textContent,'🏠');
  assert.equal(container.querySelector('[aria-label="Enlarge driveway photo"]'),null);
});
test('changing listings aborts the old gallery request and does not retain its enlarged photo',async()=>{
  const {root,container}=await mount(React.createElement(Gallery,{listing:listing(7)}));
  await React.act(()=>container.querySelector('[aria-label="Enlarge driveway photo"]').click());
  response={photos:[listing(8).img]};await React.act(async()=>root.render(React.createElement(Gallery,{listing:listing(8)})));
  assert.equal(requests[0].options.signal.aborted,true);assert.equal(container.querySelector('[role="dialog"]'),null);
  assert.equal(container.querySelector('img').getAttribute('src'),listing(8).img);
});
