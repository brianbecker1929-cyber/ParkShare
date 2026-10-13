import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmationEmailHtml, extensionConfirmedHtml, halfwayReminderHtml,
  endingReminderHtml, hostBookingNotificationHtml,
} from "../api/_email.js";

const LIVE = "https://www.myparkshare.ca";
const QA = "https://parkshare-qa.vercel.app";
const fixture = {
  bookingId: 42,
  hostName: "Sample Host",
  renterName: "Sample Driver",
  driverName: "Sample Driver",
  address: "123 Test Crescent",
  spotLabel: "A",
  vehicleSummary: "Demo Sedan",
  vehiclePlate: "TEST 123",
  vehicle: { vehicle_make: "Demo", vehicle_model: "Sedan", vehicle_colour: "Blue" },
  directionsUrl: "https://www.google.com/maps/search/?api=1&query=Toronto",
  manageReservationUrl: `${LIVE}/?view_booking=42`,
  extendUrl: `${LIVE}/?extend_booking=42`,
};
const renderers = [
  ["confirmation", confirmationEmailHtml],
  ["extension", extensionConfirmedHtml],
  ["halfway", halfwayReminderHtml],
  ["ending", endingReminderHtml],
  ["host", hostBookingNotificationHtml],
];

function withAppUrl(appUrl, run) {
  const previous = process.env.APP_URL;
  try {
    if (appUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = appUrl;
    run();
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
}

test("QA emails cannot link to the live website across all five templates", () => {
  withAppUrl(QA, () => {
    for (const [name, render] of renderers) {
      const html = render(fixture);
      assert.doesNotMatch(html, /https:\/\/www\.myparkshare\.ca/i, name);
      assert.match(html, /https:\/\/parkshare-qa\.vercel\.app\/email\/headers\//i, name);
      assert.match(html, /href="https:\/\/parkshare-qa\.vercel\.app"/, name);
      assert.match(html, /href="https:\/\/parkshare-qa\.vercel\.app\/parking\?message_booking=42"/, name);
      assert.match(html, />parkshare-qa\.vercel\.app<\/a>/, name);
      if (name !== "host") assert.match(html, /https:\/\/www\.google\.com\/maps\/search/, name);
    }
  });
});

test("QA confirmation, extension and reminders route booking actions to QA", () => {
  withAppUrl(QA, () => {
    for (const [name, render] of renderers.filter(([name]) => name !== "host")) {
      const html = render(fixture);
      assert.match(html, /href="https:\/\/parkshare-qa\.vercel\.app\/\?view_booking=42"/, name);
    }
    const hostHtml = hostBookingNotificationHtml(fixture);
    assert.match(hostHtml, /href="https:\/\/parkshare-qa\.vercel\.app\/host-dashboard"/);
  });
});

test("production renders existing live email links when APP_URL is absent", () => {
  withAppUrl(undefined, () => {
    assert.match(confirmationEmailHtml(fixture), /https:\/\/www\.myparkshare\.ca\/email\/headers/);
    assert.match(hostBookingNotificationHtml(fixture), /href="https:\/\/www\.myparkshare\.ca\/host-dashboard"/);
  });
});

test("invalid or insecure APP_URL is rejected instead of linking to an unsafe origin", () => {
  for (const bad of ["http://localhost:3000", "https://example.test/redirect", "https://name:pass@example.test/"]) {
    withAppUrl(bad, () => {
      assert.throws(() => confirmationEmailHtml(fixture), /APP_URL must be/);
    });
  }
});
