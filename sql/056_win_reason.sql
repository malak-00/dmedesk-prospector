-- BD Lead Prospector: why a lead signed.
-- MANUAL ONLY: review against the live schema before execution. The agent never executes SQL against Supabase
-- without being told to run this file. Rerun-safe. Adds one nullable column to lead_intel (sql/050); nothing else.
--
-- When a lead is marked onboarded the app asks "what tipped it?" and keeps the answer here, next to the objection
-- reps already record for the leads that say no. Together they show what wins and what loses. Without this file the
-- app keeps working: the question is simply not saved and Insights shows nothing for it.

begin;

alter table public.lead_intel
  add column if not exists win_reason text;

alter table public.lead_intel drop constraint if exists lead_intel_win_reason_check;
alter table public.lead_intel
  add constraint lead_intel_win_reason_check
  check (win_reason is null or win_reason in ('savings', 'trust', 'bad experience', 'growth', 'compliance', 'timing', 'other'));

commit;

-- Verification (read-only):
-- select win_reason, count(*) from public.lead_intel where win_reason is not null group by 1 order by 2 desc;
