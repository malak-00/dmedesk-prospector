-- BD Lead Prospector: sign-in lockout and "change your password" support.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Rerun-safe. Adds three columns to public.app_users; no data changes.
--
--   failed_logins         wrong passwords in a row for this account (reset by a good sign-in)
--   locked_until          after 5 wrong passwords the account is locked for 15 minutes;
--                         an admin can unlock it earlier from Admin > Controls
--   must_change_password  set for accounts an admin created or reset with a temporary
--                         password; the person has to choose their own before doing anything else
--
-- Without this file sign-in works exactly as before and people can still change their
-- own password; there is just no lockout and no forced change.

begin;

alter table public.app_users
  add column if not exists failed_logins integer not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists must_change_password boolean not null default false;

comment on column public.app_users.failed_logins is 'Wrong passwords in a row; reset to 0 by a successful sign-in.';
comment on column public.app_users.locked_until is 'Sign-in refused until this time (set after repeated wrong passwords). NULL = not locked.';
comment on column public.app_users.must_change_password is 'True after an admin set a temporary password; the person must choose their own first.';

commit;

-- Verification (read-only):
-- select username, failed_logins, locked_until, must_change_password from public.app_users order by username;
