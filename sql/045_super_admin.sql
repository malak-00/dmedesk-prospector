-- BD Lead Prospector: a "super admin" flag for the App insights dashboard.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Rerun-safe. Adds one boolean column to public.app_users; no existing row changes.
--
-- What it does: a super admin sees the App insights dashboard (usage, funnel, friction,
-- system health) in place of the Today screen, and may read GET /admin/insights.
-- Ordinary admins (for example Ben, who also prospects) keep the normal Today screen.
-- A super admin is also left out of the team's adoption and funnel numbers, so review
-- and test activity on that account does not skew them.
--
-- Without this file nobody is a super admin and everything works as before.

begin;

alter table public.app_users
  add column if not exists is_super_admin boolean not null default false;

comment on column public.app_users.is_super_admin is
  'Review/testing account. Sees the App insights dashboard instead of Today; excluded from team adoption and funnel numbers. Not a rep.';

commit;

-- Grant it to Caroline Richards (id from SUPABASE_CHANGELOG.md). Run separately, after checking the row:
--   select id, username, display_name, is_admin from public.app_users where id = 'c4e38805-970b-4cde-a03d-585cc0778872';
--   update public.app_users set is_super_admin = true where id = 'c4e38805-970b-4cde-a03d-585cc0778872';

-- Verification (read-only):
-- select username, display_name, is_admin, is_super_admin from public.app_users order by username;
