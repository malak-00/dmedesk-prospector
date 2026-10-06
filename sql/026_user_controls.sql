-- BD Lead Prospector: let admins remove (and restore) users without deleting them.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Rerun-safe. Adds one nullable column to public.app_users; no data changes.
--
-- Why a column and not DELETE: claimed leads, the ownership history and the match
-- decisions all point at app_users(id), and the ownership history is append-only.
-- Deleting a user would either be refused by those references or erase who did what.
-- A removed user keeps their row (so their name still reads correctly everywhere),
-- but can no longer sign in, and a signed-in session stops working within about 30
-- seconds. "Restore" simply clears the column.
--
-- Without this file the Controls tab still lists users, adds them and edits their
-- roles and passwords; only Remove / Restore asks for this to be run.

begin;

alter table public.app_users
  add column if not exists disabled_at timestamptz;

comment on column public.app_users.disabled_at is
  'When an admin removed this user. NULL = active. A removed user cannot sign in; their leads and history are untouched.';

commit;

-- Verification (read-only):
-- select username, is_admin, disabled_at from public.app_users order by username;
