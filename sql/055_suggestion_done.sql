-- DME Desk Prospector: let an admin mark a suggestion as done.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase unless told to.
-- Run any time. Rerun-safe. It adds TWO NULLABLE COLUMNS to public.suggestions:
--   done_at  when it was marked done (null = still open)
--   done_by  which admin marked it
-- Existing suggestions stay open; nothing is rewritten, dropped or deleted.
--
-- Until this is run the Admin page still lists suggestions as before, and the
-- Done button explains that this file is needed.

begin;

alter table public.suggestions
  add column if not exists done_at timestamptz,
  add column if not exists done_by uuid references public.app_users (id);

commit;

-- Verification (read-only):
--   select count(*) filter (where done_at is null) as open, count(done_at) as done from public.suggestions;
-- To undo (removes who/when for done suggestions; the suggestions themselves stay):
--   alter table public.suggestions drop column done_at, drop column done_by;
