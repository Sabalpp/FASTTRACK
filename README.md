# HVAC + Plumbing MVP

Initial working starter for a Northern Virginia HVAC + Plumbing independent contractor.

The product is deliberately simple: **Inspect → Charge → Case → Secure → Invoice → Email**. Every major screen maps to one of those verbs. The first version avoids Housecall-Pro-style complexity and focuses on the smallest useful workflow: customers, jobs, photos, parts, Good/Better/Best line items, invoice drafts, owner send, and a CallRail Phase 2 scaffold.

## What is included

- Next.js App Router + TypeScript structure
- iPad-first responsive UI
- Demo role switcher for Owner, Tech, and Call Center
- Role-aware navigation and component guards
- Universal customer search with phone normalization
- Customer create/list/detail
- Job schedule/list/detail
- Job photo metadata upload UI with demo preview
- Owner-only parts catalog
- Tech/owner Good / Better / Best line items
- Invoice draft builder and printable invoice preview
- Owner-only send stub that marks invoice as sent
- Admin allowlist screen
- Supabase SQL schema with tables, indexes, RLS policies, storage buckets, and seed parts
- `/api/webhooks/callrail` POST scaffold for Phase 2 CallRail events

## What is intentionally excluded from MVP

- Warranty tracking
- Membership tiers
- Loyalty gifts
- Payment processing
- E-signatures
- Customer portal
- Call analytics dashboard
- Old-customer migration

## Run locally

```bash
npm install
npm run dev
```

Then open the local Next.js URL. The app runs in demo mode using localStorage until Supabase credentials are configured.

## Demo login

The landing page lets you continue as:

- **Owner** — sees everything, manages parts/users, sends invoices
- **Tech** — sees assigned jobs, photos, parts for line items, and invoice drafts
- **Call Center** — searches/creates customers and schedules jobs, but sees no photos, parts, invoices, or money

Use the role switcher in the header to test access differences.

## Supabase setup

1. Create a Supabase project.
2. Open the Supabase SQL editor.
3. Run `supabase/schema.sql`.
4. Copy `.env.example` to `.env.local` and fill in:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

The current UI uses a localStorage demo store. The SQL and API route are ready for wiring the data layer to live Supabase queries as the next implementation step.

## Production auth path

The intended production auth flow is Supabase Auth + Google OAuth:

1. User signs in with Google.
2. The app checks `allowed_users` by email.
3. The user's role controls UI and database access.
4. Postgres RLS enforces row/role boundaries.

The demo role selector exists only to make the MVP easy to show before the contractor provides real users and OAuth credentials.

## CallRail Phase 2 scaffold

`/api/webhooks/callrail` accepts POST requests, normalizes caller phone digits, tries to match a customer by `phone_digits`, upserts a `call_logs` row, and records a `call_log_events` audit row when Supabase service credentials are configured.

Signature verification is intentionally marked TODO until the exact CallRail webhook secret/header settings are available.

## Build-order notes

The next most valuable engineering steps are:

1. Replace localStorage data functions in `lib/data-store.tsx` with Supabase-backed repositories.
2. Wire Supabase Auth + Google OAuth.
3. Generate private signed URLs for `job-photos` and `invoices` buckets.
4. Add real PDF generation using `@react-pdf/renderer`.
5. Add Resend email sending behind the owner-only Send button.
6. Finish CallRail signature verification after the contractor subscribes and provides webhook settings.

## Branding

Edit `lib/branding.ts` for:

- Business name
- Tagline
- Primary/accent colors
- Phone/email
- License number
- Address
- Logo placeholder
- Default tax rate


## Framer UI upgrade

This package includes a Framer-grade visual upgrade while keeping the MVP operational in Next.js:

- `/framer` — a polished clickable showroom for the contractor demo.
- `components/WorkflowRail.tsx` — reusable six-verb workflow UI.
- `framer/FramerMVPPrototype.tsx.txt` — self-contained Framer Code Component to paste into Framer.
- `FRAMER_BUILD_GUIDE.md` — exact Framer usage notes and recommended page structure.

Recommended split: use Framer to sell/show the product, and use this Next/Supabase app to run customers, jobs, photos, invoices, roles, and webhook flows.
