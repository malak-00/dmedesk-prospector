-- BD Lead Prospector: avatar team features (kudos between teammates, a daily mood check-in, call scripts).
-- Builds on 031 and 032, so run those first.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Rerun-safe. Creates three small tables; nothing existing is touched.
--
-- buddy_kudos    a thank-you from one teammate to another (140 characters). The recipient is shown it once.
-- buddy_mood     one tap a day, 1 (rough) to 3 (great), per person. Admins only ever see anonymous totals per
--                day, never who chose what.
-- buddy_scripts  openers and voicemail scripts an admin writes, for everyone or for one specialty; they appear
--                beside call mode. Retired, never deleted.
-- The weekly team call goal is a row in buddy_settings (from 032), so it needs no table of its own.
--
-- Without this file the avatar works as before; the features above say what they need.

begin;

create table if not exists public.buddy_kudos (
  id bigint generated always as identity primary key,
  from_user uuid not null references public.app_users (id),
  to_user uuid not null references public.app_users (id),
  body text not null check (char_length(body) between 1 and 140),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index if not exists buddy_kudos_to on public.buddy_kudos (to_user, created_at desc);

create table if not exists public.buddy_mood (
  user_id uuid not null references public.app_users (id),
  day date not null,
  mood smallint not null check (mood between 1 and 3),
  primary key (user_id, day)
);

create table if not exists public.buddy_scripts (
  id bigint generated always as identity primary key,
  specialty text check (specialty is null or char_length(specialty) <= 80),
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 800),
  created_by uuid references public.app_users (id),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

alter table public.buddy_kudos enable row level security;
alter table public.buddy_mood enable row level security;
alter table public.buddy_scripts enable row level security;
revoke all on table public.buddy_kudos, public.buddy_mood, public.buddy_scripts from public, anon, authenticated;

commit;

-- Verification (read-only):
-- select count(*) from public.buddy_kudos;
-- select day, mood, count(*) from public.buddy_mood group by 1, 2 order by 1 desc, 2 limit 20;
-- select id, coalesce(specialty, 'everyone') as for_whom, title from public.buddy_scripts where retired_at is null;
