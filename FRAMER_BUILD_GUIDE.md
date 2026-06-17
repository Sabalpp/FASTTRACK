# Framer Build Guide — HVAC + Plumbing MVP

## Decision

Use Framer for the polished contractor-facing demo and marketing/showroom layer. Keep the working operational app in Next.js + Supabase because the MVP needs real auth, role-specific data access, customer/job records, photo storage, invoices, PDF/email flow, and a CallRail webhook scaffold.

## What changed in this upgrade

- Added `/framer` as a high-polish clickable showroom inside the working app.
- Upgraded the global visual system: glass cards, command-center hero, role action cards, iPad-style preview, large tap targets, richer empty states, and stronger hover states.
- Added a reusable `WorkflowRail` component that expresses Inspect → Charge → Case → Secure → Invoice → Email.
- Added `framer/FramerMVPPrototype.tsx.txt`, a self-contained Framer Code Component that can be pasted into Framer for a design/demo page.
- Kept the real app flows working in `/customers`, `/jobs`, `/parts`, `/invoices`, and `/admin/users`.

## How to use the Framer code component

1. Open Framer.
2. Create a new page for the contractor demo.
3. Open Assets → Code → Create Code File.
4. Paste the contents of `framer/FramerMVPPrototype.tsx.txt`.
5. Drag the code component onto the canvas.
6. Use Framer property controls to change business name, primary color, accent color, and default role.
7. Add buttons that link to the live working app routes once the Next/Vercel app is deployed.

## Recommended Framer page structure

- Hero: “HVAC + Plumbing app that a field tech understands instantly.”
- Embedded/pasted `HVACMVPPrototype` code component.
- Three role cards: Owner, Tech, Call Center.
- Six-verb section: Inspect, Charge, Case, Secure, Invoice, Email.
- Security promise: “Call center sees scheduling only — no photos, parts, invoices, or dollars.”
- CTA: “Open working demo.”

## Keep this separation

Framer should sell and explain the product. The Next/Supabase app should run the product.

Do not rebuild the entire operational app only in Framer unless the business decides to sacrifice real backend behavior. The MVP needs database-enforced roles, private storage, invoice state, and server endpoints.
