import assert from 'node:assert/strict';
import {before,beforeEach,after,mock,test} from 'node:test';

const HOST='00000000-0000-4000-8000-000000001101';
const A='00000000-0000-4000-8000-000000001102';
const B='00000000-0000-4000-8000-000000001103';
const OTHER='00000000-0000-4000-8000-000000001104';
const PRIVATE_TITLE='123 Synthetic Private Driveway';
Object.assign(process.env,{STRIPE_SECRET_KEY:'sk_test_local_messages_only',
  SUPABASE_URL:'https://messages-005119.invalid',SUPABASE_ANON_KEY:'fixture-anon',
  SUPABASE_SERVICE_ROLE_KEY:'fixture-service'});
let handler,user,records,writes,calls,readFailure;
const makeResponse=()=>({code:200,body:null,headers:{},
  status(n){this.code=n;return this},json(body){this.body=body;return this},
  setHeader(k,v){this.headers[k]=v}});
async function request(method,body={},query={},signedIn=true){
  const res=makeResponse();
  await handler({method,body,query,url:'/api/messages',headers:signedIn?{authorization:'Bearer fixture'}:{}},res);
  return res;
}
const incoming=(id,sender,recipient,booking_id=null)=>({id,listing_id:7,sender_id:sender,recipient_id:recipient,
  booking_id,text:'Synthetic '+id,created_at:'2026-10-19T03:00:00Z'});

before(async()=>{
  mock.method(globalThis,'fetch',async(input,options={})=>{
    const url=new URL(input instanceof Request?input.url:input);
    assert.equal(url.origin,'https://messages-005119.invalid','No real HTTP request is permitted');
    if(url.pathname==='/auth/v1/user')return Response.json({id:user});
    const table=url.pathname.split('/').pop(),method=options.method||'GET';
    calls.push({table,method,params:url.searchParams});
    assert.ok(records[table],`Unexpected table ${table}`);
    if(table==='messages'&&method==='GET'&&readFailure){
      return Response.json({message:'Sensitive database failure: synthetic private body',code:'XX000'},{status:500});
    }
    if(method==='POST'){
      assert.equal(table,'messages');
      const row={id:999,...JSON.parse(options.body),created_at:'2026-10-19T03:01:00Z'};
      records.messages.push(row);writes.push(row);
      return Response.json(row,{status:201});
    }
    assert.equal(method,'GET');
    let result=records[table].filter(row=>[...url.searchParams].every(([key,value])=>{
      if(key==='or')return value.slice(1,-1).split(',').some(part=>{
        const [column,operator,...rest]=part.split('.');
        assert.equal(operator,'eq');return String(row[column])===rest.join('.');
      });
      if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
      if(value.startsWith('in.('))return value.slice(4,-1).split(',').includes(String(row[key]));
      return true;
    }));
    if(url.searchParams.has('limit'))result=result.slice(0,Number(url.searchParams.get('limit')));
    const columns=(url.searchParams.get('select')||'').split(',');
    result=result.map(row=>Object.fromEntries(columns.map(column=>[column,row[column]??null])));
    const single=new Headers(options.headers).get('accept')?.includes('application/vnd.pgrst.object+json');
    if(single&&!result.length)return Response.json({message:'not found'},{status:406});
    return Response.json(single?result[0]:result);
  });
  ({default:handler}=await import('../api/messages.js'));
});
beforeEach(()=>{
  user=A;writes=[];calls=[];readFailure=false;
  records={
    listings:[{id:7,host_id:HOST,title:PRIVATE_TITLE,address:'Synthetic exact address',price:12,spaces:2},
      {id:8,host_id:HOST,title:'Other synthetic listing'},
      {id:9,host_id:OTHER,title:'Other Host listing'}],
    profiles:[{id:HOST,name:'Synthetic Host'},{id:A,name:'Driver A'},{id:B,name:'Driver B'}],
    bookings:[{id:100,listing_id:7,renter_id:A,status:'confirmed',paid_at:'2026-10-18T12:00:00Z',stripe_checkout_session_id:'cs_synthetic_A'},
      {id:101,listing_id:7,renter_id:B,status:'confirmed',paid_at:'2026-10-18T12:00:00Z',stripe_checkout_session_id:'cs_synthetic_B'}],
    messages:[incoming(1,A,HOST),incoming(2,HOST,A),incoming(3,B,HOST),incoming(4,HOST,B)],
  };
});
after(()=>mock.restoreAll());

test('Driver A reads only their own conversation, not another Driver on the same listing',async()=>{
  const r=await request('GET',{}, {listingId:'7'});
  assert.equal(r.code,200);assert.deepEqual(r.body.messages.map(m=>m.id),[1,2]);
  assert.equal((await request('GET',{}, {listingId:'7',participantId:B})).body.messages.length,0);
});
test('Host filtered reads stay within the selected Driver thread',async()=>{
  user=HOST;
  assert.deepEqual((await request('GET',{}, {listingId:'7',participantId:A})).body.messages.map(m=>m.id),[1,2]);
});
test('unrelated Host cannot read listing or booking conversation messages',async()=>{
  user=OTHER;
  assert.equal((await request('GET',{}, {listingId:'7'})).body.messages.length,0);
  assert.equal((await request('GET',{}, {bookingId:'100'})).body.conversations.length,0);
});
test('signed-out message read/write is rejected before data access',async()=>{
  assert.equal((await request('GET',{}, {},false)).code,401);
  assert.equal((await request('POST',{listingId:7,text:'Blocked'}, {},false)).code,401);
  assert.equal(calls.length,0);assert.equal(writes.length,0);
});
test('Host cannot start an arbitrary recipient inbox or reuse a conversation on another listing',async()=>{
  user=HOST;
  assert.equal((await request('POST',{listingId:7,participantId:OTHER,text:'Blocked'})).code,403);
  assert.equal((await request('POST',{listingId:8,participantId:A,text:'Blocked'})).code,403);
  assert.equal(writes.length,0);
});
test('outgoing Host row alone is not proof that the Driver contacted the Host',async()=>{
  user=HOST;records.messages=[incoming(2,HOST,A)];
  assert.equal((await request('POST',{listingId:7,participantId:A,text:'Blocked'})).code,403);
  assert.equal(writes.length,0);
});
test('legitimate Host reply uses verified sender and established recipient',async()=>{
  user=HOST;
  const r=await request('POST',{listingId:7,participantId:A,sender_id:B,recipient_id:OTHER,text:'Reply'});
  assert.equal(r.code,201);assert.equal(writes[0].sender_id,HOST);assert.equal(writes[0].recipient_id,A);
});
test('unbooked enquiry always targets the actual listing Host, ignoring forged recipient fields',async()=>{
  const r=await request('POST',{listingId:7,participantId:B,sender_id:OTHER,recipient_id:B,text:'Question'});
  assert.equal(r.code,201);assert.equal(writes[0].sender_id,A);assert.equal(writes[0].recipient_id,HOST);
});
test('booking-linked send rejects foreign booking and cross-listing identity',async()=>{
  assert.equal((await request('POST',{listingId:7,bookingId:101,text:'Blocked'})).code,403);
  assert.equal((await request('POST',{listingId:8,bookingId:100,text:'Blocked'})).code,403);
  assert.equal(writes.length,0);
});
test('booking-linked Host initiation resolves the booked Driver on the server',async()=>{
  user=HOST;
  assert.equal((await request('POST',{listingId:7,bookingId:101,participantId:A,text:'Booking note'})).code,201);
  assert.equal(writes[0].recipient_id,B);
});
test('malformed IDs and self recipients do not fall back to a broader conversation',async()=>{
  for(const bookingId of [0,-1,'invalid','1e2','']) {
    assert.equal((await request('POST',{listingId:7,bookingId,text:'Blocked'})).code,400);
  }
  for(const query of [{listingId:'1e2'},{bookingId:'no'},{participantId:'invalid'}]) {
    assert.equal((await request('GET',{},query)).code,400);
  }
  user=HOST;
  for(const participantId of [HOST,'invalid']) {
    assert.equal((await request('POST',{listingId:7,participantId,text:'Blocked'})).code,400);
  }
  assert.equal(writes.length,0);
});
test('unpaid enquiry inbox does not expose the identifying driveway title',async()=>{
  const r=await request('GET');
  assert.equal(r.code,200);assert.equal(r.body.conversations[0].title,'Private parking');
  assert.equal(JSON.stringify(r.body).includes(PRIVATE_TITLE),false);
  assert.equal(r.body.conversations[0].otherParty,'Synthetic Host');
});
test('paid booking inbox and owning Host retain the authorized listing title',async()=>{
  records.messages=[incoming(1,A,HOST,100)];
  assert.equal((await request('GET')).body.conversations[0].title,PRIVATE_TITLE);
  user=HOST;records.messages=[incoming(1,A,HOST)];
  assert.equal((await request('GET')).body.conversations[0].title,PRIVATE_TITLE);
});
test('cancelled/unpaid booking inbox stays generic and exact context is denied',async()=>{
  records.messages=[incoming(1,A,HOST,100)];
  for(const status of ['pending','cancelled','refunded']) {
    records.bookings[0].status=status;
    assert.equal((await request('GET')).body.conversations[0].title,'Private parking');
    const context=await request('GET',{}, {contextBookingId:'100'});
    assert.equal(context.code,404);assert.equal(context.body.listing,undefined);
  }
});
test('booking email context preserves participant and paid-location authorization',async()=>{
  let r=await request('GET',{}, {contextBookingId:'100'});
  assert.equal(r.code,200);assert.equal(r.body.listing.address,'Synthetic exact address');
  user=B;r=await request('GET',{}, {contextBookingId:'100'});
  assert.equal(r.code,404);assert.equal(r.body.listing,undefined);
});
test('conversation lookup failure blocks Host reply and hides raw database details',async()=>{
  user=HOST;readFailure=true;
  const r=await request('POST',{listingId:7,participantId:A,text:'Blocked'});
  assert.equal(r.code,500);assert.equal(writes.length,0);
  assert.equal(JSON.stringify(r.body).includes('Sensitive database'),false);
});
