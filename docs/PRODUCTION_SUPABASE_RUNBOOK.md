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
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_BROWSER_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_OR_SECRET_KEY
NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=
CALLRAIL_WEBHOOK_SECRET=
RESEND_API_KEY=
INVOICE_FROM_EMAIL=invoices@fasttrackdmv.org
```

Notes:

- The browser key can be Supabase's anon key or newer publishable key, depending on the project dashboard.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it in React/client code.
- Keep demo mode false for real Supabase testing.

## Supabase SQL Setup

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

## Real Users And Roles

Production access is controlled by `allowed_users`.

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

## Auth Setup

Fastest production path:

1. Enable Google provider in Supabase Auth.
2. Add local redirect URL:
   - `http://localhost:3003/dashboard`
3. Add Vercel production redirect URL after deployment:
   - `https://YOUR_VERCEL_DOMAIN/dashboard`
4. In Google Cloud OAuth settings, add authorized origins/redirects required by Supabase.
5. Confirm a signed-in user's email exists in `allowed_users`.

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
```

5. Deploy.
6. Add the final Vercel URL to Supabase Auth redirects.
7. Redeploy if auth/env settings changed.

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
