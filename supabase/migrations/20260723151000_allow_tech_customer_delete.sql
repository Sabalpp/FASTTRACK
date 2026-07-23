-- Technicians may remove test or duplicate customers from the customer page.
-- Customer foreign keys intentionally cascade related service records.

drop policy if exists "owner deletes customers" on public.customers;
drop policy if exists "owner and tech delete customers" on public.customers;
create policy "owner and tech delete customers" on public.customers
  for delete
  using (public.is_owner() or public.is_tech());
