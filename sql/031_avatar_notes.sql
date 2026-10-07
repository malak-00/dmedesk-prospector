-- BD Lead Prospector: notes the avatar shows people (message of the day, notes for one person).
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Rerun-safe. Creates two small tables; nothing existing is touched.
--
-- buddy_notes: a note written by an admin. to_user_id is null for a note everyone sees
--   (message of the day) or a person's id for a note only they see. A note shows from
--   show_from until expires_at, and never after retired_at. Notes are retired, not deleted.
-- buddy_seen: who has already been shown which note, so each person sees it pop up once.
--
-- Size: a few hundred bytes a note. Without this file the avatar still greets and cheers people
-- (that part needs no database); it just has no notes to show.

begin;

create table if not exists public.buddy_notes (
  id bigint generated always as identity primary key,
  to_user_id uuid references public.app_users (id),
  body text not null check (char_length(body) between 1 and 500),
  created_by uuid references public.app_users (id),
  show_from timestamptz not null default now(),
  expires_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists buddy_notes_active on public.buddy_notes (show_from desc) where retired_at is null;

create table if not exists public.buddy_seen (
  note_id bigint not null references public.buddy_notes (id),
  user_id uuid not null references public.app_users (id),
  seen_at timestamptz not null default now(),
  primary key (note_id, user_id)
);

-- Service role only (the Worker); nothing here is meant for direct browser access.
alter table public.buddy_notes enable row level security;
alter table public.buddy_seen enable row level security;
revoke all on table public.buddy_notes, public.buddy_seen from public, anon, authenticated;

commit;

-- Verification (read-only):
-- select n.id, coalesce(u.display_name, 'everyone') as to_who, n.body, n.show_from, n.expires_at, n.retired_at
--   from public.buddy_notes n left join public.app_users u on u.id = n.to_user_id order by n.id desc limit 20;
