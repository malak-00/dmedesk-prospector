-- BD Lead Prospector: remember every tap on a phone number, claimed or not.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Rerun-safe. Creates one small table; nothing existing is touched.
--
-- A rep often taps a number in Prospect before the lead is claimed (or without ever claiming it).
-- A lead that is not claimed has no row to write a note on, so each tap is kept here, by person
-- and NPI. Today and Team activity count a tap as a call, and a result the same person logs in the
-- next half hour is the same call (see lib/teamActivity.js, callEvents).
--
-- Size: about 100 bytes a tap, so even 100,000 taps is around 10 MB. Old taps can be deleted at any
-- time without harm: they only feed the counts.
--
-- Without this file taps on claimed leads are still counted (written to the lead's call log, as
-- before); taps on unclaimed leads are simply not recorded.

begin;

create table if not exists public.call_taps (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.app_users (id),
  npi text not null,
  number text,
  tapped_at timestamptz not null default now()
);

create index if not exists call_taps_user_time on public.call_taps (user_id, tapped_at desc);
create index if not exists call_taps_npi on public.call_taps (npi);

-- Derived data for the service role only.
alter table public.call_taps enable row level security;
revoke all on table public.call_taps from public, anon, authenticated;

commit;

-- Verification (read-only):
-- select u.display_name, count(*) as taps, max(t.tapped_at) as latest
--   from public.call_taps t join public.app_users u on u.id = t.user_id group by 1 order by 2 desc;
