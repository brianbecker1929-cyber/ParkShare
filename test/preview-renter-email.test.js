import test from "node:test";
import assert from "node:assert/strict";
import previewRenterEmail from "../api/preview-renter-email.js";

function response() {
  return {
    statusCode: 200,
    headers: {},
    html: "",
    status(value) { this.statusCode = value; return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
    send(value) { this.html = value; return this; },
    end(value) { this.html = value; return this; },
  };
}

test("current renter email is previewable without charging or sending", async () => {
  const previous = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "production";
    let prod = response();
    await previewRenterEmail({ method: "GET" }, prod);
    assert.equal(prod.statusCode, 404);

    process.env.VERCEL_ENV = "preview";
    const demo = response();
    await previewRenterEmail({ method: "GET" }, demo);
    assert.equal(demo.statusCode, 200);
    assert.match(demo.html, /RENTER EMAIL DESIGN PREVIEW/);
    assert.match(demo.html, /Sample Driver/);
    assert.match(demo.html, /BOOKING/);
    assert.match(demo.html, /DEMO 123/);
    assert.match(demo.html, /Lexus LC · Orange/);
    assert.match(demo.html, /7:36 p\.m\./);
    assert.match(demo.html, /8:36 p\.m\./);
    assert.match(demo.html, /data:image\/png;base64,/);
    assert.doesNotMatch(demo.html, /cid:parking-spot-demo/);
    assert.equal(demo.headers["X-Robots-Tag"], "noindex, nofollow");
    assert.equal(demo.headers["Cache-Control"], "no-store");
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});
