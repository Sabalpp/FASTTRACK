-- Allow owners to remove test or duplicate customers from the customer detail page.
-- The customer foreign keys intentionally cascade jobs, invoices, photos, and history.

drop policy if exists "owner deletes customers" on public.customers;
create policy "owner deletes customers" on public.customers
  for delete
  using (public.is_owner());
