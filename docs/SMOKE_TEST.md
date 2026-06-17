# Smoke Test

## Production mode sanity

- Set `NEXT_PUBLIC_DEMO_MODE=false`.
- Confirm no demo role switcher appears.
- Confirm no local-state/demo labels appear on the login or dashboard.
- Confirm unauthenticated users land on the login screen.
- Confirm non-allowed Supabase Auth users are blocked.

## Mobile and iPad

- Open the app on phone width.
- Confirm there is no horizontal scroll.
- Confirm New job is reachable without hunting.
- Open a job.
- Confirm call, text, email, and map actions are thumb-accessible.
- Add notes and line items without the layout shifting.
- Open the same screens at iPad width.
- Confirm customer/job lists use the available width without large empty gaps.

## Database persistence

- Create customer.
- Refresh.
- Confirm customer remains.
- Open app in another browser.
- Confirm customer appears.

## Owner

- Login as owner.
- Confirm all jobs show.
- Confirm parts catalog opens.
- Confirm invoices open.
- Confirm admin users page opens.
- Send an invoice draft.
- Confirm invoice status becomes sent.
- Confirm invoice stores `sent_to_email`, `sent_at`, and eventually `pdf_storage_path`.

## Tech

- Login as tech.
- Confirm only assigned jobs show.
- Open assigned job.
- Create or intake a customer only if the current access policy allows it.
- Create or schedule a job only if the current access policy allows it.
- Add notes.
- Add line item.
- Build invoice draft.
- Confirm other tech jobs do not show.

## Call center

- Login as call center.
- Search customers.
- Create customer.
- Schedule job.
- Confirm parts route is blocked.
- Confirm invoices route is blocked.
- Confirm photos and dollar amounts do not show.

## Storage

- Upload a before photo.
- Confirm metadata row exists in `job_photos`.
- Confirm file exists in `job-photos` bucket.
- Confirm call center cannot see the photo.

## Invoice PDF and email

- Open invoice preview.
- Confirm the preview reads like a real customer-facing document, not an internal demo card.
- Generate PDF.
- Confirm PDF opens locally.
- Confirm PDF includes customer, service address, job summary, selected work, totals, tax, and invoice number.
- Confirm PDF is uploaded to the `invoices` bucket.
- Send invoice.
- Confirm the customer email receives either the PDF attachment or a valid signed link.
