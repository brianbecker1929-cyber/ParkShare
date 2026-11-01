import assert from 'node:assert/strict';
import {test,after,afterEach} from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {JSDOM} from 'jsdom';
import {computeAccessibleName,computeAccessibleDescription,getRole} from 'dom-accessibility-api';
import {validateEventSubmissionForm} from '../src/lib/eventSubmissionValidation.js';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://qa.example.invalid'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');
const roots=[];
afterEach(async()=>{for(const {root,container} of roots.splice(0)){await React.act(()=>root.unmount());container.remove();}});
after(()=>{dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
const app=await readFile(process.env.QA_CHECKBOX_APP||new URL('../src/App.jsx',import.meta.url),'utf8');
const features=await readFile(new URL('../src/components/ListingFeatureFields.jsx',import.meta.url),'utf8');
const featureCode=(await transform(features.replace(/^import .*;\n/gm,'').replace('export default function','function'),{loader:'jsx'})).code;
const FeatureFields=new Function('React','useId',featureCode+';return ListingFeatureFields;')(React,React.useId);
const colors={navy:'#0E1B2E',muted:'#666'};
const labels=['Covered / garage','CCTV / security camera','Well-lit at night','Snow removal in winter','EV charging available','Gated access'];
const eventStart=app.indexOf('function EventSubmissionForm(');
const eventCode=(await transform(app.slice(eventStart,app.indexOf('// ─── Discover View',eventStart)),{loader:'jsx'})).code;
const requests=[];
const eventDeps={React,useId:React.useId,useState:React.useState,useRef:React.useRef,useEffect:React.useEffect,validateEventSubmissionForm,C:colors,EVENT_CATEGORIES:[{value:'community',label:'Community'}],fetch:async(...args)=>{requests.push(args);throw Error('Unexpected transport in accessibility test');}};
const EventForm=new Function(...Object.keys(eventDeps),eventCode+';return EventSubmissionForm;')(...Object.values(eventDeps));
async function mount(element){const container=document.createElement('div');document.body.append(container);const root=createRoot(container);roots.push({root,container});await React.act(()=>root.render(element));return {container,root};}
function assertName(input,name){
 assert.equal(getRole(input),'checkbox');assert.equal(computeAccessibleName(input),name);assert.notEqual(computeAccessibleName(input),input.value);
 assert.ok(input.id);assert.equal(input.labels.length,1);assert.equal(input.labels[0].htmlFor,input.id);
 const labelText=document.getElementById(input.getAttribute('aria-labelledby'));assert.ok(labelText);assert.equal(labelText.textContent.trim(),name);
}
function uniqueIds(container){const ids=[...container.querySelectorAll('[id]')].map(node=>node.id);assert.equal(ids.length,new Set(ids).size);}

test('BUG-005440 every actual listing feature has its visible accessible name and explicit native label',async()=>{
 const {container}=await mount(React.createElement(FeatureFields,{form:{},onChange(){},C:colors}));const inputs=[...container.querySelectorAll('input')];assert.equal(inputs.length,6);inputs.forEach((input,i)=>{assertName(input,labels[i]);assert.equal(input.checked,false);assert.equal(input.tabIndex,0);});assert.equal(computeAccessibleName(container.querySelector('fieldset')),'Features');uniqueIds(container);
});
test('native visible-label clicks toggle the intended controlled feature without changing its transport key',async()=>{
 let values={},changes=[];
 function Form(){const [form,setForm]=React.useState({});values=form;return React.createElement(FeatureFields,{form,C:colors,onChange:(key,checked)=>{changes.push({key,checked});setForm(previous=>({...previous,[key]:checked}));}});}
 const {container}=await mount(React.createElement(Form));const input=container.querySelector('input[name="evCharging"]');await React.act(()=>input.labels[0].querySelector('span').click());assert.equal(input.checked,true);assert.deepEqual(values,{evCharging:true});assert.deepEqual(changes,[{key:'evCharging',checked:true}]);assertName(input,'EV charging available');await React.act(()=>input.labels[0].click());assert.equal(input.checked,false);assert.equal(values.evCharging,false);assert.ok([...container.querySelectorAll('input')].every(node=>!node.checked));
});
test('feature IDs remain stable on rerender and are unique across concurrent forms',async()=>{
 const props={form:{cctv:true},C:colors,onChange(){}};const tree=()=>React.createElement('div',null,React.createElement(FeatureFields,props),React.createElement(FeatureFields,props));const {container,root}=await mount(tree());const ids=[...container.querySelectorAll('input')].map(n=>n.id);assert.equal(ids.length,12);uniqueIds(container);await React.act(()=>root.render(tree()));assert.deepEqual([...container.querySelectorAll('input')].map(n=>n.id),ids);for(const input of container.querySelectorAll('input[name="cctv"]')){assert.equal(input.checked,true);assertName(input,'CCTV / security camera');}
});
test('listing wizard step 5 renders the labelled controls with its existing state/update binding',async()=>{
 const start=app.indexOf('{/* Step 5: Details */}'),tagStart=app.indexOf('<ListingFeatureFields',start);assert.ok(tagStart>start,'Step 5 must bind the explicit feature fields');const tag=app.slice(tagStart,app.indexOf('/>',tagStart)+2);const code=(await transform('function Step({form,update}){return '+tag+';}',{loader:'jsx'})).code;const Step=new Function('React','ListingFeatureFields','C',code+';return Step;')(React,FeatureFields,colors);let change;const {container}=await mount(React.createElement(Step,{form:{gated:true},update:(...args)=>{change=args;}}));assert.equal(container.querySelector('input[name="gated"]').checked,true);await React.act(()=>container.querySelector('input[name="covered"]').labels[0].click());assert.deepEqual(change,['covered',true]);assertName(container.querySelector('input[name="covered"]'),'Covered / garage');
});
const consent='I confirm that I am authorized to submit this event information and that it is accurate.';
test('actual event consent keeps its full visible name, required state and checkbox semantics',async()=>{
 const {container}=await mount(React.createElement(EventForm,{onClose(){}}));const input=container.querySelector('input[name="authorized"]');assertName(input,consent);assert.equal(input.required,true);assert.equal(input.checked,false);assert.equal(input.disabled,false);assert.equal(input.getAttribute('aria-invalid'),'false');assert.equal(input.hasAttribute('aria-describedby'),false);
});
test('native event consent label toggles its controlled state without submitting the form',async()=>{
 const {container}=await mount(React.createElement(EventForm,{onClose(){}}));const input=container.querySelector('input[name="authorized"]');const count=requests.length;await React.act(()=>input.labels[0].querySelector('span').click());assert.equal(input.checked,true);assertName(input,consent);await React.act(()=>input.labels[0].click());assert.equal(input.checked,false);assert.equal(requests.length,count);
});
test('consent validation remains an accessible description and does not replace the visible checkbox name',async()=>{
 const {container}=await mount(React.createElement(EventForm,{onClose(){}}));await React.act(()=>container.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));const input=container.querySelector('input[name="authorized"]');assert.equal(input.getAttribute('aria-invalid'),'true');assertName(input,consent);const error=document.getElementById(input.getAttribute('aria-describedby'));assert.ok(error);assert.equal(computeAccessibleDescription(input),error.textContent.trim());assert.ok(computeAccessibleDescription(input).length);assert.equal(requests.length,0);
});
test('separate event forms have independent consent label and error IDs',async()=>{
 const {container}=await mount(React.createElement('div',null,React.createElement(EventForm,{onClose(){}}),React.createElement(EventForm,{onClose(){}})));const inputs=[...container.querySelectorAll('input[name="authorized"]')];assert.equal(inputs.length,2);uniqueIds(container);for(const input of inputs)assertName(input,consent);await React.act(()=>inputs[0].labels[0].click());assert.equal(inputs[0].checked,true);assert.equal(inputs[1].checked,false);
});
