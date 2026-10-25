import test from 'node:test';
import assert from 'node:assert/strict';
import {withBookingChargeTotals} from '../api/_booking-display-total.js';
import {countOccupiedSpots} from '../api/_booking-capacity.js';
import {cancelledExtensionCheckoutHold,cancelledCheckoutHold} from '../src/lib/spotAvailability.js';

test('booking totals include only paid applied extensions and preserve original financial records',async()=>{
 const rows=[{id:1,total:'34.50'},{id:2,total:'12.01'}],calls=[];
 const ext=(changes={})=>({booking_id:1,added_amount:'17.25',application_state:'applied',paid_at:'2030-01-01',status:'confirmed',...changes});
 const query={select(fields){calls.push(fields);return this;},in(key,ids){assert.equal(key,'booking_id');assert.deepEqual(ids,[1,2]);return this;},eq(key,value){assert.equal(key,'application_state');assert.equal(value,'applied');return this;},not(key,op,value){assert.deepEqual([key,op,value],['paid_at','is',null]);return this;},order(){return this;},range(){return Promise.resolve({data:[ext(),ext({application_state:'rejected'}),ext({paid_at:null}),ext({status:'payment_failed'}),ext({booking_id:2,added_amount:0.1})]});}};
 const result=await withBookingChargeTotals({from(table){assert.equal(table,'booking_extensions');return query;}},rows);
 assert.deepEqual(result,[{id:1,total:'34.50',charged_total:51.75},{id:2,total:'12.01',charged_total:12.11}]);
 assert.deepEqual(rows,[{id:1,total:'34.50'},{id:2,total:'12.01'}]);assert.doesNotMatch(calls[0],/stripe_|renter_id/);
});
test('no bookings require no extension query; an unavailable ledger cannot silently understate the total',async()=>{
 assert.deepEqual(await withBookingChargeTotals({from(){assert.fail('no reads');}},[]),[]);
 const chain={select(){return this;},in(){return this;},eq(){return this;},not(){return this;},order(){return this;},range(){return Promise.resolve({error:new Error('unavailable')});}};
 await assert.rejects(withBookingChargeTotals({from:()=>chain},[{id:1,total:34.5}]),/unavailable/);
});
test('a booking history exceeding one API page includes every paid extension',async()=>{
 const offsets=[],rows=Array.from({length:1001},()=>({booking_id:1,added_amount:0.01,application_state:'applied',paid_at:'2030-01-01',status:'confirmed'}));
 const chain={select(){return this;},in(){return this;},eq(){return this;},not(){return this;},order(){return this;},range(a,b){offsets.push(a);return Promise.resolve({data:rows.slice(a,b+1)});}};
 assert.equal((await withBookingChargeTotals({from:()=>chain},[{id:1,total:34.5}]))[0].charged_total,44.51);
 assert.deepEqual(offsets,[0,1000]);
});
test('booking plus its extension hold uses one physical bay; independent bays and unlabelled rows remain separate',()=>{
 assert.equal(countOccupiedSpots([{id:1,spot_label:'a'}],[{id:'h',spot_label:' A '}]),1);
 assert.equal(countOccupiedSpots([{id:1,spot_label:'A'}],[{id:'h1',spot_label:'A'},{id:'h2',spot_label:'B'}]),2);
 assert.equal(countOccupiedSpots([{id:1,spot_label:null},{id:2,spot_label:null}],[{id:'h',spot_label:null}]),3);
 assert.equal(countOccupiedSpots([{id:1,spot_label:'A'},{id:2,spot_label:'A'}],[]),1);
});
test('only an extension cancellation with its own valid hold reference requests extension cleanup',()=>{
 const id='10000000-0000-4000-8000-000000000001';
 const search=`?extension_cancelled=1&extension_hold=${id}`;
 assert.equal(cancelledExtensionCheckoutHold(search),id);assert.equal(cancelledCheckoutHold(search),null);
 for(const input of [`?booking_cancelled=1&extension_hold=${id}`,`?extension_success=1&extension_hold=${id}`,`?extension_cancelled=false&extension_hold=${id}`,'?extension_cancelled=1&extension_hold=bad'])assert.equal(cancelledExtensionCheckoutHold(input),null);
});
