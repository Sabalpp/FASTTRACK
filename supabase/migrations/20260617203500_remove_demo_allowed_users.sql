-- Remove initial demo allowlist users from early production databases.
-- Real access should be managed through public.allowed_users with actual Google emails.

delete from public.allowed_users
where email in (
  'owner@fasttrack.test',
  'tech@fasttrack.test',
  'tech2@fasttrack.test',
  'calls@fasttrack.test'
);
