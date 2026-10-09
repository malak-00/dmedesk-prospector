-- BD Lead Prospector: remember phone numbers that turned out to be wrong, so nobody dials them again.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Rerun-safe. Creates one small table; nothing existing is touched.
--
-- bad_numbers: one row per (lead NPI, 10-digit number) that a rep flagged in call mode as "Wrong number" or
-- "Not in service". It is shared by the whole team, since a wrong number is wrong for everyone: call mode then
-- shows that number struck through and offers the next one on file. A flag is taken back by setting cleared_at,
-- never by deleting the row. Lead data itself is not changed.
--
-- Without this file call mode works as before; flagging says what it needs.

begin;

create table if not exists public.bad_numbers (
  id bigint generated always as identity primary key,
  npi text not null check (npi ~ '^[0-9]{10}$'),
  number text not null check (number ~ '^[0-9]{10}$'),
  reason text not null default 'wrong' check (reason in ('wrong', 'disconnected')),
  flagged_by uuid references public.app_users (id),
  flagged_at timestamptz not null default now(),
  cleared_at timestamptz,
  unique (npi, number)
);

create index if not exists bad_numbers_npi on public.bad_numbers (npi);

alter table public.bad_numbers enable row level security;
revoke all on table public.bad_numbers from public, anon, authenticated;

commit;

-- Verification (read-only):
-- select b.npi, b.number, b.reason, u.display_name as flagged_by, b.flagged_at, b.cleared_at
--   from public.bad_numbers b left join public.app_users u on u.id = b.flagged_by order by b.flagged_at desc limit 20;
