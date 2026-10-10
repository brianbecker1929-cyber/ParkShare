import test from "node:test";
import assert from "node:assert/strict";

import { renderRouteHtml } from "../scripts/prerender-public-routes.mjs";
import { getRouteFromPath } from "../src/lib/routes.js";

const template = `<!doctype html><html><head>
  <title>Default</title>
  <meta name="description" content="Default" />
  <link rel="canonical" href="https://www.myparkshare.ca/" />
</head><body><div id="root"></div></body></html>`;

test("public routes receive crawlable page content and unique metadata", () => {
  const html = renderRouteHtml(template, getRouteFromPath("/about"));
  assert.match(html, /<title>About ParkShare \| Private Parking Marketplace<\/title>/);
  assert.match(html, /<h1[^>]*>About ParkShare<\/h1>/);
  assert.match(html, /rel="canonical" href="https:\/\/www\.myparkshare\.ca\/about"/);
  assert.match(html, /name="robots" content="index, follow"/);
});

test("private account routes are prerendered as noindex without user data", () => {
  const html = renderRouteHtml(template, getRouteFromPath("/my-bookings"));
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /Sign in to securely access this page/);
  assert.doesNotMatch(html, /booking reference|licence plate/i);
});
