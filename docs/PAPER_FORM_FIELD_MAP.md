# Fast Track Paper Form Field Map

Source: user-provided photo of the current Fast Track paper service/invoice sheet on 2026-06-17.

This document captures what can be extracted from the image and how it should map into the production app. Keep this file updated as more photos, scans, or PDFs arrive.

## Extracted Company Identity

Visible company identity:

- Company name/logo: `FAST TRACK REPAIR SERVICE`
- Address: `13817 Fount Beattie Ct., Centreville, VA 20121`
- Phone: `+1 7038995615`
- Email: `Info@fasttrackdmv.org`
- Website: `WWW.FASTTRACKDMV.ORG`

Verification needed:

- Confirm exact street spelling. The image appears to read `Fount Beattie Ct.`, but this should be checked against the business records before final production invoices.
- Confirm whether the production app name should be `Fast Track Repair Service`, `Fast Track DMV`, or another legal/trade name.
- Confirm license number, tax settings, and service area.

## Extracted Paper Form Sections

Top header:

- Invoice number
- Date
- Jurisdiction/service area selector: `DC`, `MD`, `VA`

Customer and job intake:

- Customer name
- Phone
- Job street
- Unit no.
- City
- State
- Zip code
- Customer email

Equipment/appliance information:

- Type and brand name of appliance
- Model no.
- Serial no. / MFG no.
- The same appliance block appears twice on the sheet, so the app should support multiple equipment records per job.

Request and diagnosis:

- Nature of service request
- Description
- Service performed / Diagnosis

Pricing and payment:

- Job cost
- Service call
- Sub-total
- Total
- Tax
- Deposit
- Pay this amount
- Payment type checkboxes: cash, check no., credit card, other
- Card no., expiration, CVV, zip

Important payment rule:

- Do not store raw card number, CVV, or card zip in the app database. The paper form includes those fields, but the production app should use a PCI-compliant payment provider such as Stripe, Square, or a hosted payment link. Store only payment status, method label, amount, processor ID, and last 4 digits when provided by the payment processor.

Authorization of repair:

- Estimate amount
- Authorization text:
  - Estimate includes diagnostic/estimate, parts, and labor.
  - Customer authorizes repairs and agrees to pay upon completion.
  - If a part order is required, customer agrees to pay a deposit.
  - Deposit applies to the return trip to install parts.
  - Company/technicians are not responsible for damages.
- Customer signature

Additional repair authorization:

- If further analysis finds more repairs necessary, customer will be contacted for authorization of additional charges.
- `$35 Charge for return check.`

Completion of work:

- Customer acknowledges satisfactory performance/completion of repairs.
- Customer signature
- Date

Coupon:

- `$50 OFF ON YOUR NEXT COMPLETE REPAIR`

Bottom fields:

- Warranties: month / year
- Approved
- Revised estimate
- Approved by
- Technician

## Current App Mapping

Already covered by existing app/schema:

- Customer identity and address: `customers`
- Phone normalization/search: `customers.phone_digits`, `search_customers`
- Job schedule and service address: `jobs`
- Job status and assigned tech: `jobs.status`, `jobs.assigned_tech_id`
- Job photos: `job_photos` plus private `job-photos` storage bucket
- Parts/catalog items: `parts`
- Job line items: `job_line_items`
- Invoice totals/status: `invoices`
- Invoice PDF storage pointer: `invoices.pdf_storage_path`
- Allowed users and roles: `allowed_users`

Needs schema/product work:

- Multiple equipment/appliance rows per job.
- Jurisdiction field for `DC`, `MD`, `VA`.
- Separate service request vs diagnosis vs work performed fields.
- Authorization capture and completion signature records.
- Deposit/payment tracking without storing card data.
- Coupon/discount support.
- Warranty month/year support.
- PDF layout that resembles the useful structure of the paper form without copying bad paper-only practices.

## Proposed Production Schema Additions

These are not all implemented yet. Use them as the next schema pass after the initial Supabase connection is verified.

`job_equipment`

- `id`
- `job_id`
- `type_brand`
- `model_no`
- `serial_or_mfg_no`
- `sort_order`
- `created_at`

`job_authorizations`

- `id`
- `job_id`
- `authorization_type`: `repair_estimate`, `additional_repair`, `completion`
- `amount`
- `terms_text`
- `customer_name`
- `signature_storage_path` or typed signature metadata
- `signed_at`
- `created_by`

`job_payments`

- `id`
- `job_id`
- `invoice_id`
- `payment_type`: `cash`, `check`, `card`, `other`, `external_link`
- `amount`
- `status`: `pending`, `collected`, `failed`, `refunded`
- `processor`
- `processor_payment_id`
- `check_number`
- `card_last4`
- `collected_at`
- `created_by`

Optional `jobs` columns:

- `jurisdiction`
- `diagnosis`
- `work_performed`
- `warranty_months`
- `warranty_years`
- `revised_estimate`
- `approved_by`

## PDF Direction From This Sheet

The production PDF should include:

- Fast Track logo/name/contact.
- Invoice number and date.
- Customer/job address/contact.
- Jurisdiction/service state when relevant.
- Equipment/appliance rows.
- Service request.
- Diagnosis/work performed.
- Line items and totals.
- Deposit and final amount due.
- Authorization terms and signature blocks.
- Completion acknowledgement.
- Warranty fields if provided.

The app should not reproduce:

- Raw credit card number/CVV fields.
- Dense paper-only layout that is hard to read on mobile.
- Hard-coded coupon language unless the owner confirms it is still used.

## Immediate Implementation Priority

1. Connect Supabase and run the existing schema.
2. Verify customers, jobs, photos, line items, invoices, and roles persist.
3. Add `job_equipment` and production invoice/authorization fields.
4. Build the invoice PDF around this field map.
5. Add payment-provider integration only after the owner chooses Stripe, Square, or another processor.
