# Host application review

New driveway applications remain private until ParkShare staff approves them. Existing listings, bookings and Stripe connections are preserved.

## Review an application

1. Open the notification sent to **info@myparkshare.ca**. Follow its application review link, or open **Host approvals** on ParkShare.
2. Sign in with the confirmed info@myparkshare.ca account or an existing authorized staff account. A notification link alone does not grant access or approve a listing.
3. Check the property address, ownership document, driveway photos, parking spaces, availability, hourly price and parking instructions. The ownership document is private. Use **Get private document link**, then **Open ownership document**; the link expires after one minute. Generate a fresh link if necessary.
4. If details need correcting, enter a specific review note (10–1,000 characters) and choose **Request corrections**. The Host can see the note in **Your applications** on their Host Dashboard and submit a new, corrected application. This does not publish a listing.
5. When the application is acceptable, choose **Approve and publish**. ParkShare checks the Host's current Stripe readiness before publishing. If payment setup or Stripe verification is incomplete, ask the Host to finish it and try approval again later.
6. Confirm **Approved — listing published**. The listing now appears in the Host's existing dashboard and the marketplace. Retrying the same approval does not create a second listing.

## Notifications and private files

Each completed application is saved before its notification is attempted. Notification emails go only to info@myparkshare.ca and contain an authenticated review link; ownership documents are never attached. A failed email does not lose the application. Automatic retries run every five minutes, with a limit of ten delivery attempts within 23 hours of the first attempt. Staff can review the saved queue even if an email is delayed. The queue flags an unconfirmed email delivery for attention.

Ownership uploads accept PDF, JPEG, PNG or WebP, up to 5 MB. Hosts should redact unrelated financial and account details while keeping their name and property address readable. Uploading a document is not verification or approval.

New listings cannot be created through the former direct publication endpoint or browser database inserts. Approval is checked again in the database. Staff access comes from verified account identity or server-controlled authorization, never editable profile metadata.

## Release checks

Run `npm test` and `npm run build`. Database tests use isolated Postgres through PGlite with synthetic users, files, Stripe responses and mail delivery; they do not send real emails or create live listings. Apply the matching staff-approval migration before enabling the new website release. Confirm both API and cron deployments have the existing server-side Supabase, Stripe, Resend, sender and cron configuration. Do not expose these values to the browser.
