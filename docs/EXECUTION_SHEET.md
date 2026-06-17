# Execution Sheet

This sheet captures the current product direction, the cleanup logic used in the latest UI pass, and the next production decisions. Read this before future Codex work on the HVAC/plumbing MVP.

## Product Standard

This is a field-service operating app, not a demo website. Most real use will happen on an iPad or phone by a tech who is standing in a house, moving between jobs, taking photos, calling customers, adding items, and preparing an invoice. The interface should feel calm, fast, and operational.

The app is replacing the company's current paper Fast Track Repair Service service/invoice sheet. The extracted paper fields and missing production data model are captured in `docs/PAPER_FORM_FIELD_MAP.md`.

The app should use the screen for work. Avoid wide blank areas, repeated headings, decorative cards, and marketing text. Every visible element should answer one of these questions:

- What needs attention?
- Who is the customer?
- Where is the job?
- What can I do next?
- What has already happened?
- What can this role see or change?

## What Was Cleaned Up

- Rebuilt the login/auth screen around a centered app entry instead of a cluttered welcome page.
- Reduced the demo role selector to three clear roles: Owner, Tech, Desk.
- Removed demo-person language and redundant role labels from the visible shell.
- Kept demo switching behind `NEXT_PUBLIC_DEMO_MODE=true`.
- Added production-aware Supabase Auth flow and owner MFA gate support.
- Simplified the dashboard from overlapping "jobs/recent jobs/visible jobs" concepts into a tighter operational queue.
- Added a high-priority New job action.
- Replaced repeated text blocks with a workload chart and compact metrics.
- Added native contact actions for phone, SMS, email, and map links.
- Made customer detail fields editable instead of treating demo data as fixed.
- Made job status and technician assignment easier to change.
- Changed the invoice send action from a fake-looking stub to a real status update path.
- Reframed invoice preview as a PDF preview, while leaving real PDF generation as the next gap.
- Checked desktop, tablet, and mobile screenshots after the UI pass.
- Ran `npm run typecheck` and `npm run build` after implementation.

## Cleanup Logic

The design pass followed these rules:

- Remove repeated labels before adding new components.
- Prefer one strong command over several weak shortcuts.
- Put action buttons next to the data they act on.
- Make phone, email, and address fields directly useful, not just readable text.
- Keep role identity simple. The user needs access and actions, not fake demo names.
- Treat empty states as workflow states, not filler copy.
- Use charts only when they clarify operations, such as workload or invoice status.
- Keep cards for records and tools, not for every page section.
- Make records editable as soon as the UI implies they are real.
- Do not expose local/demo state language in production-facing screens.

## Current User Feedback To Preserve

- The app needs better separation between no-customer states and job scheduling.
- New job is improved but still needs a more natural place in the flow.
- Customers page still underuses available space, especially on larger screens.
- Tech flow needs a way to create customers/jobs, with access controlled by role and backend policy.
- Customer intake should feel like a clean form a customer or dispatcher can complete, not a dummy data form.
- Address entry should later support autocomplete, likely Google Places or another address API.
- Do not hard-code Virginia or any other state as a production default.
- Avoid hard-coded demo names and fake-looking sample records in production mode.
- The current `Inspect -> Charge -> Case -> Secure -> Invoice -> Email` rail is temporary. The invoice/workflow sequence needs another product pass.
- Good/Better/Best line-item entry is not good enough yet. It needs a cleaner estimate/invoice builder.
- Invoice output must be a professional PDF artifact that can be previewed, downloaded, stored, and emailed.
- Future app name/brand should be decided creatively; `Fast Track Mechanical` is only current placeholder branding.

## PDF Research

Relevant local references:

- `/Users/sabal/code/landforge-main/PDF_FINAL_HANDOFF.md`
- `/Users/sabal/code/landforge-main/src/components/TheaterWorkbench.jsx`
- `/Users/sabal/code/landforge/src/components/TheaterWorkbench.jsx`
- `/Users/sabal/code/landforge/src/components/AssessmentCards.jsx`
- `/Users/sabal/code/seaforge-frontend/src/App.jsx`
- `/Users/sabal/code/seaforge-frontend/src/components/ui/*`

Findings:

- The useful PDF generator is in `landforge-main`, not the smaller `landforge` copy.
- `landforge-main` uses `@pdfme/generator` and a structured multi-page report model.
- Its PDF flow builds a document model, lays out pages with sections, metrics, risk rows, footers, and then downloads a real `application/pdf` blob.
- It also has a fallback custom PDF builder, but that is too low-level for this app unless absolutely necessary.
- The lighter LandForge app is still useful as a report UX reference: compact report panel, severity cards, direct download action.
- SeaForge is more useful as a dashboard/component reference than as a PDF implementation reference.
- This HVAC app already has `@react-pdf/renderer` installed, so the most natural first production invoice path is to build a real invoice document component with that package, then store/send the generated PDF through Supabase Storage and the email route.

## Invoice Direction

The invoice system should become:

1. Tech adds editable work items and photos.
2. App groups items into customer-facing options or a selected estimate.
3. Owner reviews a professional invoice preview.
4. App generates a PDF artifact.
5. PDF is stored in Supabase Storage `invoices`.
6. Invoice row stores `pdf_storage_path`, `status`, `sent_to_email`, and `sent_at`.
7. Email sends the PDF as attachment or signed link.

The paper sheet adds these invoice requirements:

- Invoice number and date.
- DC/MD/VA jurisdiction.
- Customer/job address and unit.
- One or more appliance/equipment blocks.
- Nature of service request.
- Description.
- Service performed/diagnosis.
- Estimate authorization and completion acknowledgement.
- Deposit, subtotal, tax, total, and amount due.
- Warranty month/year when applicable.
- Revised estimate, approved by, and technician.
- Payment tracking, but without storing card number/CVV in the app.

The customer-facing document should include:

- Company identity and contact information.
- Customer and service address.
- Job summary.
- Work performed.
- Photos or photo references when appropriate.
- Line items with quantity, unit price, and totals.
- Selected option, not three confusing columns after approval.
- Tax, total due, payment terms, and invoice number.
- Owner-approved sent timestamp.

## Backend And Deployment Direction

Supabase remains the locked backend. The production bottleneck is now:

- Supabase project and SQL schema.
- Supabase Auth and allowed user role resolution.
- Supabase Storage for job photos and invoice PDFs.
- Vercel deployment.
- Field smoke testing with real phones/iPads.
- A way to diagnose failures quickly while on call.

For first field testing, prioritize observability:

- Clear error states in the UI.
- Server route logs for invoice/email/webhook paths.
- A simple admin-visible activity log.
- Smoke test checklist after every deploy.

## Future Codex Rule

Before implementing another UI pass, first write the intended workflow in plain English:

1. Who is using this screen?
2. What are they trying to finish?
3. What information do they need first?
4. What action should be easiest?
5. What should be hidden for this role?
6. What would look fake or hard-coded?

Then implement the smallest coherent pass, test mobile/tablet/desktop, run typecheck/build for code changes, and update this sheet if the product rules change.
