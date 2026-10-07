-- BD Lead Prospector: avatar extras (team wins, repeating notes, reactions and replies, birthdays and
-- anniversaries). Builds on 031_avatar_notes.sql, so run that first.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Rerun-safe. Adds two columns to buddy_notes and three small tables; nothing is dropped or rewritten.
--
-- buddy_notes.kind            'note' (written by an admin) or 'win' (made automatically when a lead is onboarded).
-- buddy_notes.repeat_weekday  0 (Sunday) to 6: a note that shows every week on that day. Null = shows once.
-- buddy_reactions             a person's reaction (an emoji) and/or one-line reply to a note; one row per person per note.
-- buddy_people                optional birthday (month-day only, no year) and start date, so the avatar can mark them.
-- buddy_settings              small on/off switches, e.g. whether onboarded leads are announced to the team.
--
-- Without this file the avatar still greets, cheers, shows plain notes and works as before; only the
-- features above need it.

begin;

alter table public.buddy_notes add column if not exists kind text not null default 'note';
alter table public.buddy_notes add column if not exists repeat_weekday smallint
  check (repeat_weekday is null or repeat_weekday between 0 and 6);

create table if not exists public.buddy_reactions (
  note_id bigint not null references public.buddy_notes (id),
  user_id uuid not null references public.app_users (id),
  reaction text check (reaction is null or char_length(reaction) <= 8),
  reply text check (reply is null or char_length(reply) <= 200),
  updated_at timestamptz not null default now(),
  primary key (note_id, user_id)
);

create table if not exists public.buddy_people (
  user_id uuid primary key references public.app_users (id),
  birthday_md text check (birthday_md is null or birthday_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  started_on date
);

create table if not exists public.buddy_settings (
  key text primary key,
  value text not null
);

alter table public.buddy_reactions enable row level security;
alter table public.buddy_people enable row level security;
alter table public.buddy_settings enable row level security;
revoke all on table public.buddy_reactions, public.buddy_people, public.buddy_settings from public, anon, authenticated;

commit;

-- Verification (read-only):
-- select column_name from information_schema.columns where table_name = 'buddy_notes' and column_name in ('kind', 'repeat_weekday');
-- select * from public.buddy_settings;
