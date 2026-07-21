-- Initial schema for the Vercel + Supabase migration (see
-- /MIGRATION_TO_VERCEL_SUPABASE.md at the repo root for the full plan this
-- implements). Replaces every Google Sheets tab used by appscript/services/
-- with real Postgres tables.
--
-- Run via the Supabase SQL editor, or `supabase db push` if using the
-- Supabase CLI locally.
--
-- Auth: uses Supabase Auth (auth.users) rather than a custom users table --
-- accounts are created via Supabase Auth (dashboard invite, or your own
-- signup flow), and `profiles` below only holds the app-specific fields
-- (display name, saved exclude-keywords default) that Supabase Auth itself
-- doesn't store.

create extension if not exists pgcrypto;

-- One row per signed-up user, keyed 1:1 to auth.users. Created by the
-- api/auth/login.js flow the first time a user signs in (see
-- vercel/lib/auth.js), or you can pre-create rows via the SQL editor.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  exclude_keywords text not null default '',
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
-- Row creation on first login goes through the service-role client (see
-- vercel/lib/auth.js), which bypasses RLS entirely -- these policies only
-- govern what a signed-in user can do with their OWN row afterward.
create policy "select own profile" on profiles for select
  using (id = auth.uid());
create policy "update own profile" on profiles for update
  using (id = auth.uid());

-- Replaces every "Claimed - <name>" tab, the shared Disconnected tab, AND
-- the legacy shared Leads tab -- one table, with claimed_by/is_disconnected
-- doing what separate tabs used to do. This is the single biggest
-- simplification from the Sheets model: no more per-teammate tab
-- management, and an indexed NPI lookup replaces every full-column scan
-- SheetsStore.js had to do (see ARCHITECTURE.md's "Known limitations").
create table leads (
  id uuid primary key default gen_random_uuid(),
  npi text not null,
  claimed_by uuid not null references profiles(id),
  claimed_at timestamptz not null default now(),

  -- lead data -- mirrors appscript/services/CsvExport.js's CSV_COLUMNS
  -- (fax intentionally excluded -- removed from the app on 2026-07-21)
  company_name text,
  phone text,
  website text,
  email text,
  address_line1 text,
  city text,
  state text,
  postal_code text,
  specialty text,
  contact_name text,
  contact_title text,
  contact_role text,
  contact_source text,
  additional_contacts_found text,
  rating numeric,
  score_value numeric,
  score_percentage numeric,
  data_sources text,
  medicare_claims numeric,
  medicare_beneficiaries numeric,
  medicare_payment numeric,
  contact_phone text,
  nppes_last_updated date,

  -- tracking columns -- mirrors SheetsStore.js's TRACKING_COLUMNS
  status text not null default 'new',
  status_updated_by uuid references profiles(id),
  status_updated_at timestamptz,
  -- Kept as one append-only text blob (newest entry on top, timestamped),
  -- matching the exact call-log format addLeadNote/replaceLeadNotes wrote
  -- to a Sheets cell -- deliberately NOT a separate one-row-per-note table,
  -- so the frontend's existing notes UI needs no changes.
  notes text not null default '',
  reminder_at timestamptz,

  is_disconnected boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The single indexed lookup that replaces SheetsStore.findLeadLocations_'s
-- whole-column scan (the root cause of the "Return to Prospect" timeout
-- bug fixed on 2026-07-21 -- see ARCHITECTURE.md).
create index idx_leads_npi on leads(npi);
create index idx_leads_claimed_by on leads(claimed_by) where not is_disconnected;
-- One active (non-disconnected) claim per person per NPI -- mirrors the
-- real-world invariant the Sheets model relied on tab structure for.
create unique index idx_leads_npi_claimed_by_active on leads(npi, claimed_by) where not is_disconnected;

alter table leads enable row level security;

-- Enforces "Claimed Leads always shows only your own leads" at the
-- database layer itself, not just in application code (stronger than
-- Code.js's `leads/list` route today, which is a real privacy boundary but
-- only because the application code chooses to filter -- RLS means even a
-- bug in that filtering logic can't leak another user's rows).
create policy "select own leads" on leads for select
  using (claimed_by = auth.uid());
create policy "insert own leads" on leads for insert
  with check (claimed_by = auth.uid());
create policy "update own leads" on leads for update
  using (claimed_by = auth.uid());

-- Replaces the Taxonomies tab (Facility Type | Code | Description | Enabled).
-- Shared reference data, readable/writable by any signed-in user (same
-- trust model as the Sheets version -- no approval step, anyone can add or
-- enable a row).
create table taxonomies (
  id uuid primary key default gen_random_uuid(),
  facility_type text not null,
  code text not null default '',
  description text not null default '',
  enabled boolean not null default false
);

alter table taxonomies enable row level security;
create policy "any signed-in user can read taxonomies" on taxonomies for select
  using (auth.role() = 'authenticated');
create policy "any signed-in user can write taxonomies" on taxonomies for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Seeds the 5 taxonomy options the app already shipped with before the
-- sheet-driven system existed (see appscript/services/TaxonomyService.js's
-- LEGACY_DEFAULTS_) -- kept enabled by default so a fresh deployment isn't
-- missing search filters teammates already expect.
insert into taxonomies (facility_type, description, enabled) values
  ('Durable Medical Equipment', 'Durable Medical Equipment', true),
  ('Oxygen Equipment', 'Oxygen Equipment', true),
  ('Prosthetic/Orthotic', 'Prosthetic/Orthotic', true),
  ('Orthopedic', 'Orthopedic', true),
  ('Prosthetic', 'Prosthetic', true);

-- Replaces the SearchProgress tab -- per-user, per-filter-combination
-- pagination bookmark (see appscript/services/SearchProgressService.js).
create table search_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  filter_fingerprint text not null,
  variant_skips jsonb not null default '{}',
  seen_npis text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (user_id, filter_fingerprint)
);

alter table search_progress enable row level security;
create policy "own search progress only" on search_progress for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Replaces the Suggestions tab.
create table suggestions (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  submitted_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table suggestions enable row level security;
create policy "any signed-in user can submit a suggestion" on suggestions for insert
  with check (auth.role() = 'authenticated');

-- Replaces EnrichmentCache.js (Foursquare/OSM/CMS lookups keyed by NPI).
-- No RLS -- this is server-only, accessed exclusively via the Supabase
-- service-role key from API routes, never from the browser.
create table enrichment_cache (
  cache_key text primary key,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- A cache entry older than this is treated as stale and re-fetched -- see
-- vercel/lib/services/enrichmentCache.js's TTL_MS (kept in sync at 1 hour).
create index idx_enrichment_cache_created_at on enrichment_cache(created_at);
