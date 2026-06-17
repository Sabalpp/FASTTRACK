# HVAC + Plumbing MVP — Dependency Clearing Runbook

This app is already a good clickable MVP. The dependency to clear now is making it a real working product instead of demo localStorage.

## Stack decision

Use Supabase for this app. Do not switch to Firebase for this build.

Why:
- The app is relational: customers, jobs, photos, line items, invoices, allowed users, and call logs all join together.
- The project already includes a Supabase schema and Supabase client helper.
- Row Level Security is central to the role model.
- Postgres full-text search is central to universal customer search.
- Supabase Storage fits private job photos and invoice PDFs.

Firebase is good, but choosing it now means rewriting the relational schema into document collections, rewriting search, rewriting role rules, and losing the existing Postgres/RLS foundation.

## Current blockers in the zip

1. The UI is still backed by `lib/data-store.tsx`, which writes to localStorage.
2. `supabase/schema.sql` had an RLS syntax bug in the `job_photos` select policy. This dependency pack fixes it.
3. Login is still demo role-switching in `lib/auth.tsx`.
4. Photo upload UI stores metadata, but it does not yet upload real files to Supabase Storage.
5. Invoice send is a status stub, not Resend/PDF generation.
6. The CallRail webhook exists, but signature verification is still a placeholder.

## Dependency order

### 1. Supabase project

Create one Supabase project.

Then run:

```sql
-- Supabase SQL Editor
-- paste and run supabase/schema.sql from this dependency pack
```

Verify these objects exist:

- `allowed_users`
- `customers`
- `jobs`
- `job_photos`
- `parts`
- `job_line_items`
- `invoices`
- `call_logs`
- `call_log_events`
- Storage buckets: `job-photos`, `invoices`
- RPC: `search_customers`

### 2. Environment variables

Create `.env.local` from `.env.local.production.example`.

Minimum values:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true
```

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in browser code.

### 3. Auth

Replace demo role switching with Supabase Auth.

Dependency chain:

```text
Google login works
  -> app reads session email
  -> app looks up matching allowed_users row
  -> app gets role
  -> UI renders role-aware pages
  -> RLS filters database rows
```

Keep demo role switching behind a `NEXT_PUBLIC_DEMO_MODE=true` flag only.

### 4. Data layer

Do not rewrite all screens first.

Preserve the current `useAppData()` interface, but change its implementation:

```text
localStorage implementation
  -> Supabase-backed implementation
  -> same functions returned to pages/components
```

This protects the UI work already done.

### 5. Universal search

Use the Supabase RPC:

```ts
const { data, error } = await supabase.rpc("search_customers", {
  search_query: query,
  limit_count: 25,
});
```

Then map snake_case rows to the existing camelCase TypeScript types.

### 6. Storage

Photo upload dependency chain:

```text
user selects file
  -> upload to private `job-photos` bucket at `${jobId}/${Date.now()}_${file.name}`
  -> insert row in `job_photos`
  -> display through signed URL or authenticated storage URL
```

Invoice PDF dependency chain:

```text
invoice draft exists
  -> generate PDF server-side
  -> upload to private `invoices` bucket as `${invoiceId}.pdf`
  -> owner sends email
  -> status becomes sent
```

### 7. Smoke-test matrix

Owner:
- Can see all jobs.
- Can see photos.
- Can manage parts.
- Can review/send invoices.
- Can manage allowed users.

Tech:
- Can see assigned jobs only.
- Can see related customer info.
- Can upload job photos.
- Can add line items.
- Can create invoice draft.
- Cannot see other tech jobs.

Call center:
- Can search/create customers.
- Can schedule jobs.
- Cannot see photos.
- Cannot see parts.
- Cannot see invoices.
- Cannot see dollar amounts.

## Definition of working today

The product is working when:

1. A real Supabase project holds customers/jobs/parts/invoices.
2. Google login returns the correct allowed user role.
3. Owner, Tech, and Call Center see different data.
4. Customer search reads from Supabase.
5. Creating a customer/job persists after refresh and across browsers.
6. Tech line items persist.
7. Invoice draft persists.
8. Owner send updates invoice status.
9. Photos upload to Supabase Storage or are intentionally blocked with a clear TODO.
10. Deployment has env vars set and loads on a real URL.
