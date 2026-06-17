# Codex Master Prompt — Make This MVP Actually Work

You are working inside the `hvac-plumbing-mvp` Next.js 15 + TypeScript app.

Goal: convert the existing clickable/localStorage MVP into a Supabase-backed working MVP while preserving the Framer-polished UI and existing routes.

Read first:
- `docs/EXECUTION_SHEET.md`
- `docs/PAPER_FORM_FIELD_MAP.md`
- `docs/PRODUCTION_SUPABASE_RUNBOOK.md`

Hard requirements:
- Use Supabase, not Firebase.
- Treat the current six-verb product flow as temporary product structure: Inspect → Charge → Case → Secure → Invoice → Email.
- Do not expand demo fluff, fake names, local-state labels, or hard-coded production-looking data.
- Keep the UI mobile/iPad-first for field techs and dispatchers.
- Preserve the existing pages and components unless a change is required for real data.
- Keep demo role switching only behind `NEXT_PUBLIC_DEMO_MODE=true`.
- In production mode, use Supabase Auth and `allowed_users` to resolve role by session email.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in client code.
- Keep CallRail as Phase 2 scaffold only.
- For invoice work, use `@react-pdf/renderer` in this app or the `landforge-main` `@pdfme/generator` pattern as the reference. Do not leave invoice output as only a visual card.
- The real paper form is the source of truth for missing production fields. Extracted fields live in `docs/PAPER_FORM_FIELD_MAP.md`.
- Do not store raw card numbers, CVV, or card zip from the paper form. Use a PCI-compliant payment provider.

Files to inspect first:
- `lib/data-store.tsx`
- `lib/auth.tsx`
- `lib/supabase.ts`
- `lib/types.ts`
- `supabase/schema.sql`
- `components/PhotoUploader.tsx`
- `components/GlobalSearch.tsx`
- `app/api/webhooks/callrail/route.ts`

Implementation tasks:

1. Fix and validate `supabase/schema.sql`.
   - Ensure it runs cleanly in Supabase SQL Editor.
   - Ensure RLS is enabled.
   - Ensure `search_customers` RPC exists.
   - Ensure private buckets exist: `job-photos`, `invoices`.
   - Ensure storage policies exist for job photos.
   - Ensure invoice PDF storage has owner write/update/delete policies.

2. Add environment flags.
   - `NEXT_PUBLIC_DEMO_MODE=true|false`
   - `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true|false`
   - Keep `.env.example` updated.

3. Replace demo auth with production-aware auth.
   - If demo mode: keep current role switcher.
   - If production mode: use Supabase Auth session.
   - Resolve the current user from `allowed_users` by email.
   - If no matching active allowed user: show “Access not allowed.”

4. Replace localStorage data store with a Supabase-backed adapter.
   - Keep the exported `useAppData()` shape stable if possible.
   - Add row mapping helpers between snake_case and camelCase.
   - Load allowed users, customers, jobs, job photos, parts, line items, invoices, call logs.
   - Rely on RLS for role filtering.
   - Mutations must write to Supabase and then refresh local state.

5. Universal customer search.
   - Update `searchCustomers()` to call Supabase RPC `search_customers` when Supabase mode is active.
   - Keep current local search only in demo mode.

6. Photo uploads.
   - In production mode, upload files to Supabase Storage bucket `job-photos`.
   - Path format: `${jobId}/${photoId}.${extension}` so storage objects can be traced back to `job_photos.id`.
   - Insert metadata row into `job_photos`.
   - Display previews using signed URLs or authenticated URLs.

7. Invoice draft.
   - Keep Good/Better/Best calculation in `lib/invoice.ts`.
   - Persist invoice draft to Supabase `invoices` table.
   - Owner send can remain a stub for now, but it must update `status='sent'`, `sent_to_email`, and `sent_at` in Supabase.

8. Route guard hardening.
   - Owner-only: `/parts`, `/parts/new`, `/admin/users`.
   - Call center blocked from photos, parts, line items, invoices, and dollar amounts.
   - Tech sees assigned jobs only.

9. Testing.
   - Run `npm run typecheck`.
   - Run `npm run build`.
   - Create a smoke test checklist in `docs/SMOKE_TEST.md`.

Acceptance test:
- Create a real customer in one browser session.
- Refresh page: customer remains.
- Open another browser: customer appears.
- Schedule job as call center.
- Login as tech: only assigned job appears.
- Add line items and invoice draft as tech.
- Login as owner: invoice draft appears and can be marked sent.
- Login as call center: invoices and parts are inaccessible.

Next production schema pass:
- Add multiple equipment/appliance records per job.
- Add jurisdiction: DC, MD, VA.
- Separate service request, diagnosis, and work performed.
- Add authorization/completion signature records.
- Add payment/deposit tracking without storing card data.
