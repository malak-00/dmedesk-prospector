-- BD Lead Prospector: a note to tomorrow's you (the avatar's end-of-shift handover note).
-- Builds on 031 to 033; this file only needs the app_users table.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Rerun-safe. Creates one small table; nothing existing is touched.
--
-- buddy_handover: one row per person, the latest note they left for their next shift. It is shown to that
-- person once at their next sign-in (shown_at is then set). Only the owner and the Worker ever see it.
--
-- Without this file everything else in the avatar works; the handover note says what it needs.

begin;

create table if not exists public.buddy_handover (
  user_id uuid primary key references public.app_users (id),
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now(),
  shown_at timestamptz
);

alter table public.buddy_handover enable row level security;
revoke all on table public.buddy_handover from public, anon, authenticated;

commit;

-- Verification (read-only):
-- select count(*) as notes, count(shown_at) as already_shown from public.buddy_handover;
