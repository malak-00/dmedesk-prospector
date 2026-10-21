-- BD Lead Prospector: follow-up dates on call intel, and the team's weekly goals.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase without being told to run this file.
-- Rerun-safe. Needs sql/050_lead_intel.sql first. Adds two columns and one small table; nothing is dropped.
--
-- Follow-up date (lead_intel.follow_up_at, follow_up_by): "come back to this lead on this day", set from the call
-- intel box. It works on any lead, claimed or not, and belongs to the person who set it: it shows on their Today
-- screen from that day until they mark it done. Without this file the date field says it is not installed yet.
--
-- Weekly goals (team_goals): a few numbers an admin sets (calls and meetings per week) so the super admin Home can
-- show progress. One row per goal key. Without this file Home shows no goal bars.

begin;

alter table public.lead_intel add column if not exists follow_up_at date;
alter table public.lead_intel add column if not exists follow_up_by uuid references public.app_users (id);

create index if not exists lead_intel_follow_up on public.lead_intel (follow_up_by, follow_up_at) where follow_up_at is not null;

create table if not exists public.team_goals (
  key text primary key check (key in ('calls_week', 'meetings_week')),
  value integer not null check (value between 0 and 100000),
  updated_by uuid references public.app_users (id),
  updated_at timestamptz not null default now()
);

-- Service role only, like the other team tables.
alter table public.team_goals enable row level security;
revoke all on table public.team_goals from public, anon, authenticated;

commit;

-- Verification (read-only):
-- select column_name from information_schema.columns where table_name = 'lead_intel' and column_name like 'follow_up%';
-- select * from public.team_goals;
