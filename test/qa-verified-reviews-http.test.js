import assert from "node:assert/strict";
import test from "node:test";

const DRIVER = "00000000-0000-4000-8000-0000000000b2";
const HOST = "00000000-0000-4000-8000-0000000000b1";
const eligibleBooking = {
  id: 51, listing_id: 7, renter_id: DRIVER,
  hours: 2, status: "confirmed", paid_at: "2026-10-10T09:00:00Z",
  stripe_checkout_session_id: "cs_paid_51", booking_date: null, start_hour: null
};
const response = () => ({
  code: 200, body: null, headers:{},
  setHeader(k,v){this.headers[k]=v; return this},
  status(n){this.code=n;return this},
  json(b){this.body=b;return this}
});

test("review HTTP endpoint verifies actual Driver stay and rejects fake reviews", async () => {
  const env={
    STRIPE_SECRET_KEY:"sk_test_dummy",SUPABASE_URL:"https://test.invalid",
    SUPABASE_ANON_KEY:"sample-anon",SUPABASE_SERVICE_ROLE_KEY:"sample-service"
  };
  const previous = Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));
  const savedFetch = globalThis.fetch;
  Object.assign(process.env,env);
  let userId=DRIVER, hostId=HOST, bookings=[eligibleBooking], duplicate=false;
  const posted=[];
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(input instanceof Request ? input.url : input);
    assert.equal(url.hostname,"test.invalid");
    const method=init.method||"GET";
    if(url.pathname==="/auth/v1/user") return Response.json({id:userId});
    if(url.pathname==="/rest/v1/listings") {
      return Response.json({id:7,host_id:hostId});
    }
    if(url.pathname==="/rest/v1/bookings") {
      assert.equal(url.searchParams.get("renter_id"),"eq."+userId);
      assert.equal(url.searchParams.get("listing_id"),"eq.7");
      return Response.json(bookings);
    }
    if(url.pathname==="/rest/v1/reviews" && method==="POST") {
      const body=JSON.parse(init.body);
      posted.push(body);
      if(duplicate) return Response.json({
        code:"23505",message:"duplicate key value violates unique constraint"
      },{status:409});
      return Response.json({id:123,listing_id:body.listing_id,rating:body.rating,
        created_at:"2026-10-17T00:00:00Z"});
    }
    assert.fail("Unexpected fetch route "+method+" "+url.pathname);
  };
  try{
    const {default:handler}=await import("../api/reviews.js");
    async function send(body={}) {
      const res=response();
      await handler({method:"POST",headers:{authorization:"Bearer fake-token"},
        body:{listingId:7,rating:5,text:"Good parking",...body}},res);
      return res;
    }
    let r=await send({user_id:"someone-else"});
    assert.equal(r.code,201);
    assert.equal(posted.length,1);
    assert.equal(posted[0].user_id,DRIVER);
    assert.equal(posted[0].listing_id,7);
    assert.equal(r.body.review.id,123);
    assert.equal(r.headers["Cache-Control"],"no-store");

    bookings=[];
    r=await send();
    assert.equal(r.code,403);
    assert.equal(posted.length,1);

    bookings=[{...eligibleBooking,status:"refunded"}];
    r=await send();
    assert.equal(r.code,403);

    bookings=[{...eligibleBooking,paid_at:"2026-10-30T09:00:00Z"}];
    r=await send();
    assert.equal(r.code,403);

    bookings=[eligibleBooking];
    userId=HOST;
    r=await send();
    assert.equal(r.code,403);
    assert.equal(posted.length,1);

    userId=DRIVER;
    duplicate=true;
    r=await send();
    assert.equal(r.code,409);
    assert.equal(posted.length,2);

    r=await send({text:{object:"not a review"}});
    assert.equal(r.code,400);
    assert.equal(posted.length,2);
    r=await send({rating:6});
    assert.equal(r.code,400);
    r=await send({listingId:-1});
    assert.equal(r.code,400);
  } finally {
    globalThis.fetch=savedFetch;
    for(const [key,val] of Object.entries(previous)) {
      if(val===undefined) delete process.env[key];
      else process.env[key]=val;
    }
  }
});
