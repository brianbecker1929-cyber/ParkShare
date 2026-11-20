import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SUPPORT_EMAIL } from "../src/lib/supportContact.js";
import { buildEmailPayload } from "../api/_email.js";

const read = name => readFile(new URL(name, import.meta.url), "utf8");

test("published support inbox matches the existing contact-form destination", () => {
  assert.equal(SUPPORT_EMAIL, "info@myparkshare.ca");
});

test("contact-form customer replies go to the submitted customer address", () => {
  const payload = buildEmailPayload({
    to: SUPPORT_EMAIL,
    replyTo: "customer@example.com",
    subject: "ParkShare Support: Booking — PK-123",
    html: "<p>Booking support request</p>",
  });
  assert.deepEqual(payload.to, [SUPPORT_EMAIL]);
  assert.equal(payload.reply_to, "customer@example.com");
  assert.equal(payload.subject, "ParkShare Support: Booking — PK-123");
  assert.equal(payload.html, "<p>Booking support request</p>");
});

test("existing transactional email without Reply-To preserves its original payload", () => {
  const payload = buildEmailPayload({
    to: "driver@example.com",
    subject: "Booking confirmed",
    html: "<p>Confirmation</p>",
    attachments: [{ filename: "ticket.png", content: "ZmlsZQ==" }],
  });
  assert.deepEqual(payload.to, ["driver@example.com"]);
  assert.equal(payload.reply_to, undefined);
  assert.equal(payload.cc, undefined);
  assert.equal(payload.attachments.length, 1);
});

test("contact endpoint uses the shared inbox, sets Reply-To and keeps failure routing consistent", async () => {
  const code = await read("../api/contact.js");
  assert.match(code, /import \{ SUPPORT_EMAIL \} from "\.\.\/src\/lib\/supportContact\.js"/);
  assert.match(code, /to: SUPPORT_EMAIL,/);
  assert.match(code, /replyTo: cleanEmail,/);
  assert.match(code, /Please email \$\{SUPPORT_EMAIL\} directly/);
  assert.match(code, /or email \$\{SUPPORT_EMAIL\} directly/);
  assert.doesNotMatch(code, /support@myparkshare\.ca/i);
});

test("all public legal and contact links resolve through the canonical mailbox", async () => {
  const app = await read("../src/App.jsx");
  assert.match(app, /import \{ SUPPORT_EMAIL \} from "\.\/lib\/supportContact"/);
  assert.match(app, /<LegalLink href=\{\x60mailto:\$\{SUPPORT_EMAIL\}\x60\}>\{SUPPORT_EMAIL\}<\/LegalLink>/);
  assert.match(app, /<a href=\{\x60mailto:\$\{SUPPORT_EMAIL\}\x60\}>\{SUPPORT_EMAIL\}<\/a>/);
  assert.doesNotMatch(app, /mailto:Support@myparkshare\.ca/i);
});

test("booking confirmations and reminders default to the same public support address", async () => {
  for (const file of ["../api/stripe-webhook.js", "../api/send-reminders.js"]) {
    const src = await read(file);
    assert.match(src, /import \{ SUPPORT_EMAIL \} from "\.\.\/src\/lib\/supportContact\.js"/);
    assert.match(src, /process\.env\.SUPPORT_EMAIL \|\| SUPPORT_EMAIL/);
    assert.doesNotMatch(src, /"support@myparkshare\.ca"/i);
  }
});
