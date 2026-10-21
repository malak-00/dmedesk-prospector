-- BD Lead Prospector: calls imported from the phone system's call log (CDR).
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase without being told to run this file.
-- Rerun-safe. Creates one table; nothing existing is touched.
--
-- The team's phone system (Ultatel) keeps an exact record of every call: who made it, to which number, when, how long
-- it lasted and how it ended. Until now the app only knew about calls from phone-number taps and typed results.
-- An admin imports the phone system's call log as a CSV (Insights > System), and these rows then give exact pickup
-- numbers: the "Answered X of Y calls" chip on a lead, and the Phone system calls card on Insights.
--
-- A row is matched to a lead by phone number (the 10 digits), not stored against an NPI, so a lead that gains or
-- changes a number is matched on what it has now. The same call imported twice is ignored (agent + number + time).
-- Size: about 150 bytes a call; 100,000 calls is around 15 MB.
-- Without this file the app keeps working: the import says it is not installed yet.

begin;

create table if not exists public.call_records (
  id bigint generated always as identity primary key,
  called_at timestamptz not null,
  agent text not null default '' check (char_length(agent) <= 80),
  phone text not null check (phone ~ '^[0-9]{10}$'),
  duration_sec integer check (duration_sec is null or duration_sec between 0 and 86400),
  disposition text check (disposition is null or char_length(disposition) <= 40),
  imported_by uuid references public.app_users (id),
  imported_at timestamptz not null default now(),
  unique (agent, phone, called_at)
);

create index if not exists call_records_phone on public.call_records (phone);
create index if not exists call_records_time on public.call_records (called_at desc);

-- Service role only, like the other team tables.
alter table public.call_records enable row level security;
revoke all on table public.call_records from public, anon, authenticated;

commit;

-- Verification (read-only):
-- select count(*), min(called_at), max(called_at) from public.call_records;
