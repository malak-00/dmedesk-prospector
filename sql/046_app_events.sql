-- BD Lead Prospector: a small event log for the App insights dashboard.
-- Reviewed and applied by hand in Supabase. The agent only runs it when told to.
-- Rerun-safe. Creates one table; nothing existing is touched.
--
-- What it records, one row each (written by the Worker after the response is sent, so it never slows a request):
--   kind 'search'   a search finished: name 'companies' or 'nppes', how many results, how long it took, and a
--                   short summary of what was asked (state, specialty, the NAMES of the filters used, never typed
--                   text, phone numbers or NPIs).
--   kind 'feature'  a feature was used: call tap, note, export, brief, booked meeting, bad number flag, ...
--   kind 'error'    a request failed (server error, or a failed search/feature call): path, status and a short message.
-- It records who (user_id) so the dashboard can say how many people use a thing. It never stores request bodies,
-- notes, passwords or tokens.
--
-- Size: roughly 150 bytes a row. A busy day is a few hundred rows. See the optional cleanup at the bottom.
-- Without this file the app works as before and the dashboard says events are not being collected yet.

begin;

create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references public.app_users (id),
  kind text not null check (kind in ('search', 'feature', 'error')),
  name text not null check (char_length(name) between 1 and 80),
  status smallint,
  ms integer,
  result_count integer,
  detail jsonb
);

create index if not exists app_events_time on public.app_events (created_at desc);
create index if not exists app_events_kind_name on public.app_events (kind, name, created_at desc);

-- Service role only (the Worker); nothing here is meant for direct browser access.
alter table public.app_events enable row level security;
revoke all on table public.app_events from public, anon, authenticated;

commit;

-- Verification (read-only):
-- select kind, name, count(*), max(created_at) from public.app_events group by 1, 2 order by 3 desc;

-- Optional cleanup, run by hand now and then to keep the table small (the dashboard reads at most 90 days):
-- delete from public.app_events where created_at < now() - interval '120 days';
