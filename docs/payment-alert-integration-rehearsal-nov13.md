# Isolated alert-flow rehearsal

Run by `.github/workflows/payment-alert-integration.yml` on a disposable
GitHub runner. Results are saved as the sanitized
`payment-alert-integration-results` artifact, bound to the exact source SHA.

The rehearsal uses PostgreSQL 17, a digest-pinned PostgREST 16.5 image from
Supabase's official registry, and the installed Supabase JavaScript client.
It loads the actual webhook and email-worker handler bodies with a
synthetic payment-failure adapter. The reporter, outbox SQL and drain worker
are the application implementations. Real database API requests validate
argument names, return shapes, role switching, permissions and durable state.

Checks cover a signed synthetic application failure, preservation of HTTP
500, one durable alert, an authenticated worker invocation, simulated email
acceptance, replay deduplication, persisted backoff, expired lease recovery,
the 23-hour ambiguity cutoff, role/JWT isolation and stale acknowledgements.

Safety boundaries:

- A dedicated loopback `/parkshare_test` database must have an empty public
  schema. The script refuses hosted URLs, other database names, connection
  options and execution outside a disposable GitHub runner before connecting.
- Database roles and JWTs are synthetic and ephemeral. No production or QA
  credentials are copied. The client is explicitly injected with a loopback
  endpoint; no hosted Supabase URL is contacted.
- The email adapter validates the intended provider URL and redirects only
  to a loopback HTTP simulator. No real email, payment, refund, transfer or
  provider webhook replay occurs. No financial tables are present.
- No hosted target, extra project subscription, Vercel environment change or
  scheduler activation is required. Production and frozen QA stay unchanged.

This verifies the controlled application/database/worker handoff with a
simulated email provider. Brian separately confirmed the real Gmail TEST
message from the existing email connection. These are complementary results;
they do not certify production configuration, a deployed alert worker,
managed-project API version/settings, scheduling, or independent outage
monitoring. Production rollout and the remaining readiness gates stay open.

Primary setup references:

- https://docs.postgrest.org/en/v16/references/auth.html
- https://docs.postgrest.org/en/v16/references/configuration.html
- https://github.com/supabase/cli/pkgs/container/postgrest
