-- BD Lead Prospector: a profile picture for each person.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Rerun-safe. Creates one small table; nothing existing is touched.
--
-- user_avatars: one row per person, the picture an admin uploaded in Admin > Controls. The browser shrinks it to
-- about 160 pixels before uploading, so it is stored as a small image (a data URL, up to 60,000 characters,
-- roughly 10 to 20 KB). It shows next to their name in the header, in Team activity, in kudos and birthday
-- messages. A person without one gets a round badge with their initials. A picture is removed by setting
-- image to null, never by deleting the row.
--
-- Without this file everyone simply shows initials, and uploading says what it needs.

begin;

create table if not exists public.user_avatars (
  user_id uuid primary key references public.app_users (id),
  image text check (image is null or char_length(image) <= 60000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id)
);

alter table public.user_avatars enable row level security;
revoke all on table public.user_avatars from public, anon, authenticated;

commit;

-- Verification (read-only):
-- select u.display_name, (a.image is not null) as has_picture, a.updated_at
--   from public.app_users u left join public.user_avatars a on a.user_id = u.id order by u.display_name;
