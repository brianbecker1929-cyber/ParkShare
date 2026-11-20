import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appUrl = new URL("../src/App.jsx", import.meta.url);

function footerSocialSource(app) {
  const start = app.indexOf('function HomeFooter(');
  assert.ok(start >= 0, "HomeFooter must exist");
  const end = app.indexOf('className="ps-footer-v2-column"', start);
  assert.ok(end > start, "the footer's social section must precede navigation");
  return app.slice(start, end);
}

test("BUG-005141: an unverified Facebook page cannot receive a clickable footer link", async () => {
  const src = await readFile(appUrl, "utf8");
  const social = footerSocialSource(src);
  assert.doesNotMatch(social, /<a\b[^>]*\bhref="https?:\/\/(?:www\.)?facebook\.com\//i);
  assert.doesNotMatch(social, /<a\b[^>]*\baria-label="ParkShare on Facebook"/);
  assert.doesNotMatch(social, /https:\/\/www\.facebook\.com\/ParkerParksHere\//);
  assert.match(social, /<span aria-label="ParkShare Facebook link being verified" title="Facebook link being verified" aria-disabled="true" style=\{\{ \.\.\.socialIconStyle, opacity: 0\.45, cursor: "default" \}\}>f<\/span>/);
});

test("BUG-005141: the icon remains present, visually subdued, and not keyboard-focusable", async () => {
  const src = await readFile(appUrl, "utf8");
  const social = footerSocialSource(src);
  assert.match(social, /width: 30, height: 30, borderRadius: "50%"/);
  assert.match(social, /Facebook link being verified/);
  assert.doesNotMatch(social, /<span[^>]*Facebook[^>]*tabIndex=\{0\}/);
  assert.doesNotMatch(social, /<button[^>]*Facebook/);
});

test("BUG-005141: retain verified-social-link layout and external-tab security attributes", async () => {
  const src = await readFile(appUrl, "utf8");
  const social = footerSocialSource(src);
  assert.match(social, /<a href="https:\/\/www\.instagram\.com\/myparkshare\/" target="_blank" rel="noopener noreferrer" aria-label="ParkShare on Instagram"/);
  assert.match(social, /<a href="https:\/\/www\.youtube\.com\/@ParkerParksHere" target="_blank" rel="noopener noreferrer" aria-label="ParkShare on YouTube"/);
  assert.match(social, /<span aria-label="X link coming soon" title="X link coming soon" aria-disabled="true"/);
  assert.match(social, /<span aria-label="LinkedIn link coming soon" title="LinkedIn link coming soon" aria-disabled="true"/);
  assert.equal((social.match(/aria-label="ParkShare Facebook link being verified"/g) || []).length, 1);
});
