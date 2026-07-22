# Production Supabase Runbook

This is the setup path for turning the Fast Track demo into a production Supabase + Vercel app.

## Current Locked Architecture

- Frontend: Next.js 15 App Router.
- Hosting: Vercel.
- Database: Supabase Postgres.
- Auth: Supabase Auth, with app roles resolved from `public.allowed_users`.
- Storage: Supabase Storage private buckets.
- Demo mode: localStorage role switcher only when `NEXT_PUBLIC_DEMO_MODE=true`.

Do not replace Supabase with Firebase. Do not build a separate custom auth system before the Supabase-backed data model is working.

## Local Environment

Create `.env.local` locally. Do not commit it.

```bash
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_BROWSER_KEY
# Optional legacy fallback. Leave blank if using the publishable key above.
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_OR_SECRET_KEY
SUPABASE_DB_URL=postgresql://postgres.PROJECT_REF:PERCENT_ENCODED_PASSWORD@HOST:6543/postgres
NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true
NEXT_PUBLIC_REQUIRE_OWNER_MFA=false
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=
CALLRAIL_WEBHOOK_SECRET=
TRANSACTIONAL_EMAIL_PROVIDER=auto
SENDGRID_API_KEY=
SENDGRID_REGION=global
RESEND_API_KEY=
TRANSACTIONAL_FROM_EMAIL=Fast Track <notifications@fasttrackdmv.org>
INVOICE_FROM_EMAIL=Fast Track <invoices@fasttrackdmv.org>
APPOINTMENT_FROM_EMAIL=Fast Track <appointments@fasttrackdmv.org>
INVOICE_SMS_LINK_TTL_SECONDS=604800
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWILIO_MESSAGING_SERVICE_SID=
TWILIO_FROM_NUMBER=
TWILIO_WEBHOOK_PUBLIC_URL=https://YOUR_DOMAIN.example/api/webhooks/twilio
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_MODE=test
STRIPE_CURRENCY=usd
STRIPE_CHECKOUT_EXPIRY_MINUTES=31
NEXT_PUBLIC_APP_URL=https://YOUR_DOMAIN.example
```

Use a public Mapbox token that can call Geocoding v6 and render the Static
Images suggestion map. The selected address is retrieved with permanent
geocoding before it is saved, so the Mapbox account must be eligible for
permanent storage. Temporary suggestions are never persisted.

Notes:

- New Supabase projects show `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The app also supports the older `NEXT_PUBLIC_SUPABASE_ANON_KEY` name as a fallback.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it in React/client code.
- Keep demo mode false for real Supabase testing.
- Keep `NEXT_PUBLIC_REQUIRE_OWNER_MFA=false` for first production testing. Turn it on only after the owner has enrolled a TOTP/authenticator factor in Supabase Auth.

## Transactional Email And SMS Activation

Provider activation is environment-only; no source edit or feature toggle is
needed after credentials are available. Copy the messaging block from
`.env.local.production.example` into the matching Vercel environments.

- `TRANSACTIONAL_EMAIL_PROVIDER=auto` chooses Twilio SendGrid when
  `SENDGRID_API_KEY` is present, then falls back to Resend when
  `RESEND_API_KEY` is present. Set the selector explicitly only when both keys
  exist and one provider must be forced.
- Verify each configured `TRANSACTIONAL_FROM_EMAIL`, `INVOICE_FROM_EMAIL`, or
  `APPOINTMENT_FROM_EMAIL` sender with the selected provider. SendGrid uses the
  official v3 Mail Send API; credentials remain server-only.
- For Twilio SMS, configure either a Messaging Service SID or an owned E.164
  sender number. Production should use an API key SID/secret for outbound API
  calls; `TWILIO_AUTH_TOKEN` is still required to verify Twilio webhooks.
- Register the exact `TWILIO_WEBHOOK_PUBLIC_URL` with the Twilio Messaging
  Service for incoming messages and Advanced Opt-Out. The deployed default is
  `/api/webhooks/twilio` on the production origin.
- Invoice texts contain a signed link to the existing private PDF. The default
  expiry is seven days; `INVOICE_SMS_LINK_TTL_SECONDS` accepts 300 through
  2592000 seconds.

The current `email_notifications_enabled` preference and audited SMS opt-in are
transactional permissions for appointment and invoice updates only. They do
not authorize promotional or marketing email/SMS; add separate consent fields
and workflows before any future campaign feature.

External account work is still required: sender/domain verification, Twilio
number or Messaging Service provisioning, applicable messaging registration,
and webhook registration. Do not paste provider secrets into source files.

## Stripe Card, Cash, And Check Activation

Card collection uses Stripe-hosted Checkout, so card numbers and CVV never
enter Fast Track. App activation is environment-only:

1. Paste `STRIPE_SECRET_KEY` into Vercel.
2. Register `https://fasttrack-delta.vercel.app/api/webhooks/stripe` in Stripe.
3. Subscribe it to `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, and
   `refund.created`, `refund.updated`, and `refund.failed`.
4. Paste that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
5. Use `STRIPE_MODE=test` with test keys for acceptance. Switch the mode, secret
   key, and webhook secret together to `live` only for real collection.
6. Keep `STRIPE_CURRENCY=usd`, set `NEXT_PUBLIC_APP_URL` to the production
   origin, and redeploy.

Both Stripe secrets are intentionally required before Checkout can open. Cash
and check collection use the same immutable ledger without external provider
credentials. An open card checkout reserves the balance, so the invoice price
and manual payments stay frozen until Stripe confirms completion or expiry.

## Supabase SQL Setup

For an existing Fast Track database, paste `SUPABASE_DB_URL` into `.env.local`
and run the checked migration wrapper. It validates the URL and always performs
a dry run before the real push:

```bash
npm run db:migrate:dry-run
npm run db:migrate
npm run db:status
```

The current rollout applies, in order, the authorization/draft relaxation,
audited optional photo checkpoints, invoice-delivery fencing, and the Stripe /
cash / check payment ledger. Do not remove the hosted demo lock until the
migration list shows all four 20260722 migrations.

Fastest path for today's setup:

1. Open Supabase project dashboard.
2. Go to SQL Editor.
3. Run `supabase/schema.sql`.
4. Confirm these tables exist:
   - `allowed_users`
   - `customers`
   - `jobs`
   - `job_photos`
   - `parts`
   - `job_line_items`
   - `invoices`
   - `invoice_delivery_audit`
   - `invoice_payments`
   - `stripe_webhook_events`
   - `call_logs`
   - `call_log_events`
5. Confirm this RPC exists:
   - `search_customers(search_query text, limit_count integer)`
6. Confirm these private storage buckets exist:
   - `job-photos`
   - `invoices`
7. Confirm RLS is enabled on all app tables.

GitHub/migration path:

- The same initial schema is also stored at `supabase/migrations/20260617141654_initial_fasttrack_schema.sql`.
- Use that migration file as the canonical source for future schema history.
- If Supabase dashboard still shows `Last migration: No migrations`, it means the SQL has not been applied through the dashboard/CLI yet. The GitHub connection alone does not create tables.
- After the first manual SQL Editor run, future schema changes should be added as new timestamped files under `supabase/migrations/`.
- Arrival-window rollout is deliberately phased: apply `20260720235000_add_job_arrival_windows.sql`, deploy the matching app commit, then apply `20260720235500_protect_job_arrival_workflow.sql`. The first migration adds the columns and server-authoritative arrival RPC; the second locks protected fields after the new role-aware UI is live.

Current project URL supplied during setup:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://ktoiuukldiulasymxdzi.supabase.co
```

Do not commit the publishable/browser key or service role key to the repo. Put them in `.env.local` locally and Vercel Environment Variables.

## Real Users And Roles

Production access is controlled by `allowed_users`.

Google Auth only proves who the person is. It does not decide whether that Google account belongs in Fast Track. The app must resolve the signed-in email against `public.allowed_users`, and Supabase RLS must continue using the same table for database access. A Google account that is not active in `allowed_users` can complete the Google OAuth popup, but it must not reach the dashboard or read/write app records.

Use real emails:

```sql
insert into public.allowed_users (email, role, display_name, active)
values
  ('OWNER_EMAIL_HERE', 'owner', 'Owner Name', true),
  ('TECH_EMAIL_HERE', 'tech', 'Tech Name', true),
  ('DESK_EMAIL_HERE', 'call_center', 'Desk Name', true)
on conflict (email) do update
set role = excluded.role,
    display_name = excluded.display_name,
    active = excluded.active;
```

Role behavior:

- `owner`: all records, parts, users, invoices, send actions.
- `tech`: assigned jobs, job photos, line items, invoice draft work, and card / cash / check collection for assigned invoices.
- `call_center`: customers and jobs, no photos/parts/invoices/money.

Owner user management:

- Owners open `/admin/users`.
- Add the person's real Google email before they try to use the app.
- Change role there when someone moves between owner, tech, and call-center access.
- Deactivate a user instead of deleting them when access should be revoked.
- Do not change or deactivate the currently signed-in owner from the UI.

## Auth Setup

Fastest production path:

1. Enable Google provider in Supabase Auth.
2. Add local redirect URL:
   - `http://localhost:3003/dashboard`
3. Add Vercel production redirect URL after deployment:
   - `https://YOUR_VERCEL_DOMAIN/dashboard`
4. In Google Cloud OAuth settings, add authorized origins/redirects required by Supabase.
5. Confirm a signed-in user's email exists in `allowed_users`.

Expected login behavior:

- Listed active email: reaches `/dashboard` with the role from `allowed_users`.
- Listed inactive email: redirected back to sign-in with an allowlist error.
- Unlisted email: redirected back to sign-in with an allowlist error.
- The Google button should always prompt account selection so a user can switch accounts cleanly.

If the client does not want Google:

- Use Supabase email/password or magic link.
- Keep `allowed_users` role resolution.
- Do not bypass RLS with a custom local login.

## Vercel Setup

1. Import `https://github.com/Sabalpp/FASTTRACK`.
2. Framework should auto-detect Next.js.
3. Add all production env vars in Vercel Project Settings.
4. Set:

```bash
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true
NEXT_PUBLIC_REQUIRE_OWNER_MFA=false
```

5. Deploy.
6. Add the final Vercel URL to Supabase Auth redirects.
7. Redeploy if auth/env settings changed.

For appointment SMS, also set the server-only `TWILIO_ACCOUNT_SID`, primary
`TWILIO_AUTH_TOKEN`, sending credentials, and:

```bash
TWILIO_WEBHOOK_PUBLIC_URL=https://fasttrack-delta.vercel.app/api/webhooks/twilio
```

In Twilio's incoming-message/Advanced Opt-Out webhook setting, use the same URL
with retry overrides appended:

```text
https://fasttrack-delta.vercel.app/api/webhooks/twilio#rc=3&rp=all&ct=2000&rt=5000&tt=15000
```

Keep `TWILIO_WEBHOOK_PUBLIC_URL` itself fragment-free. Twilio excludes connection
override fragments from signature calculation, and the app adds the retry
overrides automatically to outbound message status callbacks.

Use that exact URL as the Messaging Service incoming-message webhook. The app
adds the same URL as the outbound delivery-status callback. Twilio signs the
literal configured URL, so changes to its host, path, or query string require a
matching Vercel environment update and redeploy. Keep
`SUPABASE_SERVICE_ROLE_KEY` configured; signed webhooks fail closed without it.
Set a long random `CRON_SECRET` as well so Vercel can authorize the daily
notification outbox catch-up job declared in `vercel.json`.

If the deployed app shows `Owner`, `Tech`, and `Desk` buttons, it is running in the temporary acceptance-test demo. A live operational deployment should show `Continue with Google`; check Vercel environment variables and redeploy the latest `main` branch before real use.

Hosted builds allow the demo role picker when `NEXT_PUBLIC_DEMO_MODE=true` is explicitly set at build time. During the current owner acceptance pass, `lib/runtime.ts` also contains a clearly marked temporary hosted-demo lock so the Vercel release cannot accidentally touch live browser data even if the environment variable remains false. Remove that lock, set the variable back to `false`, and redeploy before Stripe or real operations. Outside an explicitly locked acceptance release, a hosted build must never fall back to demo mode merely because Supabase variables are missing.

## Production Smoke Test

Run this after every schema/env/deploy change:

1. Owner signs in.
2. Owner can open `/dashboard`, `/customers`, `/jobs`, `/parts`, `/invoices`, `/admin/users`.
3. Create a customer.
4. Refresh. Customer persists.
5. Create a job for that customer.
6. Assign a tech.
7. Tech signs in and sees only assigned job.
8. Tech uploads a job photo from iPad/phone, or explicitly confirms a skipped checkpoint.
9. Refresh. The photo or audited skip still appears.
10. Tech adds line items.
11. Owner opens the invoice draft.
12. Confirm job photos appear in the invoice preview and generated PDF.
13. Owner sends the invoice by email and, with current SMS consent, by text.
14. Assigned tech collects a Stripe test card payment and records test cash/check receipts.
15. Desk/call-center signs in and cannot access parts, invoice money, or photos.

## Known Gaps Before Real Client Launch

- Need schema addition for multiple appliance/equipment records.
- Need separate, explicit marketing consent and campaign tooling before any promotional email or SMS.
- Need Stripe Terminal only if Fast Track later chooses a physical iPad card reader; hosted Checkout is the current card path.
- Need final Fast Track branding, logo, license, and legal text verification.
- Need owner MFA enrollment if owner account handles sensitive access.
- Need CallRail signature verification before accepting real webhook traffic.

## Agent Rule

Before changing production data behavior, inspect:

- `docs/PAPER_FORM_FIELD_MAP.md`
- `docs/EXECUTION_SHEET.md`
- `docs/CODEX_MASTER_PROMPT.md`
- `supabase/schema.sql`
- `lib/data-store.tsx`
- `lib/auth.tsx`
