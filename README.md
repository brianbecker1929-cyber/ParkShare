ParkShare app
Stripe Connect setup
This build uses Stripe-hosted onboarding and direct charges on each Host's connected account. ParkShare collects a 15% application fee.
1. Run the database migration
In Supabase SQL Editor, run:
supabase-migration-002-stripe-connect.sql
2. Add Vercel environment variables
Add these in Vercel Project Settings → Environment Variables for Preview and Production:
STRIPE_SECRET_KEY — use sk_test_... in Preview and sk_live_... in Production
STRIPE_WEBHOOK_SECRET — signing secret for the matching webhook endpoint
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
APP_URL — for example https://parkshare-project.vercel.app
Keep all secret and service-role values server-side. Do not prefix them with VITE_.
3. Configure Stripe webhooks
Create a webhook destination pointing to:
https://YOUR_DOMAIN/api/stripe-webhook
Enable events from Connected accounts because ParkShare uses direct charges. Subscribe to:
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
account.updated
charge.refunded
charge.dispute.created
Use a separate webhook destination and signing secret for test mode and live mode.
4. Test before live mode
Sign up as a ParkShare Host.
Open Host Dashboard and select Connect Stripe.
Complete Stripe test onboarding.
Confirm the dashboard says Stripe payouts ready.
Sign in as a different Driver and book the Host's real database listing.
Confirm the booking appears only after the signed webhook is received.
Verify the payment is on the connected account and the 15% application fee is on the ParkShare platform.
