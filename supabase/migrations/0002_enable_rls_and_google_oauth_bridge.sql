-- Applied directly to project pcvyrkisvvtiteoiuplg via the Supabase MCP
-- connector on 2026-07-21. Recorded here so `supabase db push` against a
-- fresh project reproduces the same state as the real one.
--
-- Two things this does:
--   1. Bridges `app_users` to Supabase Auth so a Google OAuth login maps
--      1:1 onto an app_users row: app_users.id becomes a foreign key into
--      auth.users(id), and username/password_hash/display_name (originally
--      required for the plaintext-password model 0001_init.sql sketched)
--      become nullable since a Google-created row has none of those.
--   2. Enables Row-Level Security on every table (it shipped disabled) with
--      policies mirroring the "own rows only" invariants the Sheets model
--      relied on tab structure for -- see lib/http.js and
--      lib/services/*.js for how each API route relies on these.

alter table public.app_users
  alter column username drop not null,
  alter column password_hash drop not null,
  alter column display_name drop not null;

alter table public.app_users
  add constraint app_users_id_fkey foreign key (id) references auth.users(id) on delete cascade;

-- RLS: app_users
alter table public.app_users enable row level security;
create policy "select own app_user row" on public.app_users for select
  using (id = auth.uid());
create policy "update own app_user row" on public.app_users for update
  using (id = auth.uid());

-- RLS: leads
alter table public.leads enable row level security;
create policy "select own leads" on public.leads for select
  using (claimed_by = auth.uid());
create policy "insert own leads" on public.leads for insert
  with check (claimed_by = auth.uid());
create policy "update own leads" on public.leads for update
  using (claimed_by = auth.uid());

-- RLS: lead_notes (ownership via parent lead)
alter table public.lead_notes enable row level security;
create policy "select notes on own leads" on public.lead_notes for select
  using (exists (select 1 from public.leads l where l.id = lead_notes.lead_id and l.claimed_by = auth.uid()));
create policy "insert notes on own leads" on public.lead_notes for insert
  with check (exists (select 1 from public.leads l where l.id = lead_notes.lead_id and l.claimed_by = auth.uid()));

-- RLS: taxonomies (shared reference data)
alter table public.taxonomies enable row level security;
create policy "any signed-in user can read taxonomies" on public.taxonomies for select
  using (auth.role() = 'authenticated');
create policy "any signed-in user can write taxonomies" on public.taxonomies for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- RLS: search_progress
alter table public.search_progress enable row level security;
create policy "own search progress only" on public.search_progress for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- RLS: suggestions
alter table public.suggestions enable row level security;
create policy "any signed-in user can submit a suggestion" on public.suggestions for insert
  with check (auth.role() = 'authenticated');
create policy "select own suggestions" on public.suggestions for select
  using (submitted_by = auth.uid());

-- RLS: enrichment_cache (server-only, no policies -- accessed exclusively via service-role key)
alter table public.enrichment_cache enable row level security;

-- Seed default taxonomies (table shipped empty)
insert into public.taxonomies (facility_type, description, enabled)
select * from (values
  ('Durable Medical Equipment', 'Durable Medical Equipment', true),
  ('Oxygen Equipment', 'Oxygen Equipment', true),
  ('Prosthetic/Orthotic', 'Prosthetic/Orthotic', true),
  ('Orthopedic', 'Orthopedic', true),
  ('Prosthetic', 'Prosthetic', true)
) as seed(facility_type, description, enabled)
where not exists (select 1 from public.taxonomies);
