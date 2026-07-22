# Owner configuration audit

This audit separates normal business choices that should be editable in the app from security, consent, and signed-record invariants that must remain code-controlled.

## Delivered in this release

- Owner scheduling settings for the default arrival-window length, business-day start/end, and time increment. The Eastern business timezone stays visible but locked until every customer-notification path consumes the shared setting.
- A derived preview of the day's standard arrival windows so changing the hours or length also changes the number of displayed windows.
- Exact start and end time controls on each new or existing job. Existing appointment timestamps do not move when a default changes.
- Native date/time inputs, which use the iPad's familiar wheel-style picker.

## Next owner settings

| Priority | Setting | Safe behavior |
| --- | --- | --- |
| P0 | Business profile | Editable legal name, address, phone, email, license number, and approved logo. Remove the current license placeholder before live invoices. |
| P0 | Tax profile | Effective-dated rates for future estimates. Never recalculate an existing signed authorization or issued invoice. |
| P0 | Operating calendar | Weekly open days/hours, closure dates, booking lead time, and booking horizon, with an audited owner override. |
| P1 | Appointment communication | Owner-selectable email/SMS triggers and editable policy copy. Consent checks, STOP/HELP handling, and required disclosures remain fixed. |
| P1 | Service territory | Owner base location plus ZIP/radius or bounds to replace the current Northern Virginia search bias. |
| P1 | Dispatch overlap policy | Configurable warning buffer and warn/owner-override behavior. Arrival windows must not be treated as estimated service duration. |
| P2 | Estimate display labels | Editable customer-facing labels while stable internal tier IDs remain unchanged and signed labels are snapshotted. |
| P2 | Invoice numbering | One-time prefix/starting-number setup before the first live invoice; issued numbers remain immutable. |
| P2 | Card checkout expiry | Owner choice inside Stripe's supported safety bounds. |

## Keep code-controlled

- Role permissions and workflow locks.
- Immutable arrival, skip, signature, delivery, and payment audit records.
- Signature hashes, versioned legal terms, and signed price/tax snapshots.
- SMS consent, STOP/HELP processing, and separation of transactional and promotional consent.
- Notification idempotency, provider retry locks, webhook signature validation, and payment reconciliation.
- Upload, private-link, and request-size security limits.

## Migration rule

New settings apply prospectively. Existing jobs keep their stored UTC start/end timestamps, and signed or issued financial records keep their original business details, tax values, labels, and terms.
