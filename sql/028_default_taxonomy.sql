-- BD Lead Prospector: let an admin choose the specialty the search form starts with.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Rerun-safe. Adds one column to public.taxonomies; no data changes.
--
-- default_for_search marks at most one specialty. When someone opens the search form in a
-- new session with nothing remembered, that specialty is ticked for them (they can change it
-- freely). Without this file everything works as before and the admin setting asks for it.

begin;

alter table public.taxonomies
  add column if not exists default_for_search boolean not null default false;

-- At most one row can be the default.
create unique index if not exists taxonomies_one_default
  on public.taxonomies (default_for_search)
  where default_for_search;

comment on column public.taxonomies.default_for_search is
  'The specialty the search form starts with for everyone. At most one row.';

commit;

-- Verification (read-only):
-- select facility_type, code, default_for_search from public.taxonomies where default_for_search;
