import test from "node:test";
import assert from "node:assert/strict";
import previewRenterEmail from "../api/preview-renter-email.js";
import previewHostEmail from "../api/preview-host-email.js";
import { sampleEmailBooking } from "../api/_email-preview.js";

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
    const images = demo.html.match(/data:image\/png;base64,/g) || [];
    assert.equal(images.length, 3, "Logo, Parker portrait and driveway render inline");
    assert.match(demo.html, /ParkShare — William and Parker with the signature wordmark/);
    assert.doesNotMatch(demo.html, /email\/logo\.png/);
    assert.match(demo.html, /width="329"/);
    assert.match(demo.html, /Parker holding his phone with the ParkShare app/);
    assert.doesNotMatch(demo.html, /cid:parking-spot-demo/);
    assert.equal(demo.headers["X-Robots-Tag"], "noindex, nofollow");
    assert.equal(demo.headers["Cache-Control"], "no-store");
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});

test("all five email previews display the same high-resolution silver vehicle PNG", async () => {
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "preview";
  try {
    let expectedMap;
    let expectedLogo;
    for (const template of ["host", "confirmation", "extension", "halfway", "ending"]) {
      const res = response();
      const handler = template === "host" ? previewHostEmail : previewRenterEmail;
      await handler({ method: "GET", query: { template, vehicle: "silver", spot: "D" } }, res);
      assert.equal(res.statusCode, 200, template);
      const logos = [...res.html.matchAll(/<img[^>]*src="(data:image\/png;base64,[^"]+)"[^>]*alt="ParkShare — William and Parker with the signature wordmark"[^>]*width="329"/g)];
      assert.equal(logos.length, 1, template + " must include the approved logo");
      expectedLogo ||= logos[0][1];
      assert.equal(logos[0][1], expectedLogo, template + " must match the Host logo");
      assert.doesNotMatch(res.html, /email\/logo\.png/);
      if (template === "halfway") {
        assert.match(res.html, /Halfway/);
        assert.match(res.html, /check-in/);
        assert.match(res.html, /30 minutes remaining/);
        assert.doesNotMatch(res.html, /15 minutes|ending soon/);
      } else if (template === "ending") {
        assert.match(res.html, /ending soon/);
        assert.match(res.html, /ends in 15 minutes/);
        assert.doesNotMatch(res.html, /Halfway|30 minutes/);
      }
      const maps = [...res.html.matchAll(/<img[^>]*src="(data:image\/png;base64,[^"]+)"[^>]*width="180"/g)];
      assert.equal(maps.length, 1, template + " must include one detailed driveway");
      expectedMap ||= maps[0][1];
      assert.equal(maps[0][1], expectedMap, template + " must preserve the same vehicle and Spot D");
      assert.match(res.html, /Spot D/);
      assert.doesNotMatch(res.html, /\[[A-Z_]+\]|cid:parking-spot-demo|height:260px; width:auto/);
    }
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});

test("preview selectors only choose fixed demo vehicles and protect A-D labels", () => {
  for (const spot of ["A", "B", "C", "D"]) {
    const sample = sampleEmailBooking({ vehicle: "yellow", spot });
    assert.equal(sample.vehicle.vehicle_colour, "Yellow");
    assert.equal(sample.spotLabel, spot);
    assert.equal(sample.spotStates[sample.chosenIndex], true);
    assert.equal(sample.spotStates.filter(Boolean).length, 1);
  }
  for (const query of [{ vehicle: "<script>", spot: "<script>" }, { vehicle: ["silver"], spot: ["A"] }]) {
    assert.equal(sampleEmailBooking(query).vehicle.vehicle_colour, "Orange");
    assert.equal(sampleEmailBooking(query).spotLabel, "B");
  }
});
