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
NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true
NEXT_PUBLIC_REQUIRE_OWNER_MFA=false
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=
CALLRAIL_WEBHOOK_SECRET=
RESEND_API_KEY=
INVOICE_FROM_EMAIL=invoices@fasttrackdmv.org
```

Notes:

- New Supabase projects show `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The app also supports the older `NEXT_PUBLIC_SUPABASE_ANON_KEY` name as a fallback.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it in React/client code.
- Keep demo mode false for real Supabase testing.
- Keep `NEXT_PUBLIC_REQUIRE_OWNER_MFA=false` for first production testing. Turn it on only after the owner has enrolled a TOTP/authenticator factor in Supabase Auth.

## Supabase SQL Setup

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
- `tech`: assigned jobs, job photos, line items, invoice draft work.
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

Hosted builds allow the demo role picker only when `NEXT_PUBLIC_DEMO_MODE=true` is explicitly set at build time. Use that setting only for a temporary acceptance-test deployment: it swaps the browser UI to seeded localStorage data and simulated messaging. Set it back to `false` and redeploy before real operations. A hosted build never falls back to demo mode merely because Supabase variables are missing; it should show a Supabase configuration/auth error instead.

## Production Smoke Test

Run this after every schema/env/deploy change:

1. Owner signs in.
2. Owner can open `/dashboard`, `/customers`, `/jobs`, `/parts`, `/invoices`, `/admin/users`.
3. Create a customer.
4. Refresh. Customer persists.
5. Create a job for that customer.
6. Assign a tech.
7. Tech signs in and sees only assigned job.
8. Tech uploads a job photo from iPad/phone.
9. Refresh. Photo still appears through a signed URL.
10. Tech adds line items.
11. Owner opens the invoice draft.
12. Owner marks invoice sent.
13. Desk/call-center signs in and cannot access parts, invoice money, or photos.

## Known Gaps Before Real Client Launch

- Need schema addition for multiple appliance/equipment records.
- Need production invoice PDF generation and storage.
- Need email sending with Resend or another provider.
- Need payment processor decision. Do not store card number/CVV.
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
