-- BD Lead Prospector: comments and tags on a lead without claiming it.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Rerun-safe. Creates two small tables; nothing existing is touched.
--
-- Until now a rep could only write a note on a lead after claiming it (the notes live on the claimed
-- lead's row). These tables let anyone on the team leave a short comment or a tag on any provider by NPI,
-- claimed or not, so what one rep learns ("closed Fridays", "wheelchair only") is there for the next.
--
--   lead_comments  append-only: a comment is never edited or deleted, so there is always a trail.
--   lead_tags      one row per (NPI, tag); the person who added a tag, or an admin, can remove it.
--
-- Both are shared by the whole team. Size: about 150 bytes a comment or tag; 100,000 rows is around 15 MB.
-- Without this file the app keeps working: comments and tags simply say they are not installed yet.

begin;

create table if not exists public.lead_comments (
  id bigint generated always as identity primary key,
  npi text not null,
  user_id uuid not null references public.app_users (id),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists lead_comments_npi_time on public.lead_comments (npi, created_at desc);

create table if not exists public.lead_tags (
  npi text not null,
  tag text not null check (char_length(tag) between 1 and 24),
  user_id uuid not null references public.app_users (id),
  created_at timestamptz not null default now(),
  primary key (npi, tag)
);

create index if not exists lead_tags_tag on public.lead_tags (tag);

-- Service role only, like the other team tables: the Worker reads and writes on behalf of the signed-in user.
alter table public.lead_comments enable row level security;
alter table public.lead_tags enable row level security;
revoke all on table public.lead_comments from public, anon, authenticated;
revoke all on table public.lead_tags from public, anon, authenticated;

commit;

-- Verification (read-only):
-- select count(*) from public.lead_comments;
-- select tag, count(*) from public.lead_tags group by 1 order by 2 desc;
