# BUG-005461 — private Host account profile

Recovery QA / Stripe TEST only. The owner approved a private Host profile page.
This repair implements the missing editor without changing the Driver vehicle
profile, listing settings or Stripe payout identity.

## Behavior

- Hosts have a Profile tab in the shared desktop/mobile navigation and can open
  the existing private `/profile` URL directly. The account page is noindex and
  renders no account data into the build-time public document.
- Hosts load their current canonical display name, contact phone and read-only
  sign-in email. Name and phone can be saved; phone may be blank. Email/login
  identity changes require a separate verified workflow and are not offered here.
- Successful saves update the current Host's UI immediately. The display name is
  written to `profiles.name`, which the Dashboard hydration and Messages API use.
  Reload profile reads persisted data independently of cached client metadata.
- Phone is stored only in the existing private Auth metadata, not public listing
  fields. Vehicle details, booking records, payments and payout setup are retained.

## API and account isolation

`GET /api/host-profile` and `PATCH /api/host-profile` use the existing bearer-token
verification, then authorize the current database-owned Host role. Every table
read/write is scoped to that verified user's ID; the name update also requires
the row still to have the Host role. JWT user metadata is not used to authorize.

PATCH accepts only name and phone. It rejects identity, email, password, role,
vehicle, payout and other unexpected fields. It validates names and optional
phone numbers before writing. Returned data is limited to this Host's ID, role,
name, phone and email. All responses use `Cache-Control: private, no-store`;
unsupported methods advertise only GET/PATCH. The original Driver-only vehicle
profile API continues to reject Hosts.

Name is saved in profiles, then only the name/phone Auth metadata keys are
updated. Supabase merges those keys rather than replacing unrelated metadata.
Responses are checked for the expected account and actual saved fields. These
are **two separate provider operations**, not one transaction. A failure after
the first can partially save details; the endpoint returns an uncertain outcome,
the UI does not claim success, and Reload profile retrieves the actual state.
No automatic write retries or compensating writes are performed.

The client captures normalized save values, checks its current session before
and after the response, strips extra response fields, rejects mismatched-account
or malformed success payloads and does not refresh/replace SDK session storage.
The form blocks synchronous duplicate submissions and edits during save.
Read attempts are abortable and scoped to a mounted account generation; account
changes immediately hide the old profile while the next one loads. Unmount,
StrictMode replay and A-to-B-to-A account changes cannot revive an old response.
The root profile callback updates only a matching current Host account.

## Validation

Focused coverage exercises the actual API handler, client request helper and
React form, including canonical save/reload, read-only email, associated labels,
validation/focus, private caching, role and ID attacks, partial provider failures,
duplicate clicks, network failures, account switches, unmount and StrictMode.
Existing Driver, account and metadata/public-document regressions are retained.
The new Host Profile navigation regression fails against the prior App source.

A read-only query against recovery QA confirmed existing profiles columns
`id uuid`, `name text` and `role text`; no schema change is needed. Automated
provider tests use synthetic records and do not create or modify real accounts,
send email or perform a financial action. Browser/provider acceptance remains
with BetterQA. Local/browser automation was unavailable in this environment.

## BetterQA — PARK-TC-027

1. Sign in as a Host, open Profile from the desktop navigation and 390×844 Host
   menu, then open `/profile` directly. Verify canonical details and no Driver
   vehicle fields or incomplete-Driver-profile indicator.
2. Edit name and phone, save once, confirm the success message and updated Host
   greeting, then reload the page and Reload profile. Verify persistence. Open
   or refresh a booking conversation from the other participant's account and
   verify the Host's new display name. Existing loaded conversations may need
   a refresh; this does not add real-time name broadcasts.
3. Verify the email is read-only; blank phone is accepted; incomplete phone and
   invalid name produce labelled inline errors and focus the first invalid field.
4. Throttle/fail reads and saves. Loading must hide old account data; failures
   must show explicit guidance with Reload profile. A partial/uncertain save must
   never display success. Check the persisted state before repeating a save.
5. Double-submit, navigate away during a save, sign out, switch A-to-B-to-A and
   repeat with delayed responses. No old profile may replace the current one.
6. Confirm a Driver still gets the Driver profile and can save vehicles; signed-out
   `/profile` asks for sign-in; signed-out/Driver requests to the Host API are denied.
   Crafted cross-account, role, email, vehicle and payout updates must be rejected.
7. Recheck the homepage deferred password chunk and current security/readiness
   gates. Keep QA/Stripe TEST; do not merge or deploy to production.

References:

- https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid
- https://github.com/supabase/auth/blob/master/internal/models/user.go
- https://supabase.com/docs/reference/javascript/auth-getuser
