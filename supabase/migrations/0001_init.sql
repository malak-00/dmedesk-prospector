-- Initial schema for the Vercel + Supabase migration (see
-- /MIGRATION_TO_VERCEL_SUPABASE.md at the repo root, section 1, for the plan
-- this implements). Replaces every Google Sheets tab used by
-- appscript/services/ with real Postgres tables.
--
-- Run via the Supabase SQL editor, or `supabase db push` if using the
-- Supabase CLI locally.
--
-- Auth: uses a custom `app_users` table (not Supabase Auth's own metadata)
-- so an admin can manage accounts directly via the table editor, closer to
-- the old "add a row to the Users tab" workflow. See
-- 0002_enable_rls_and_google_oauth_bridge.sql for how this table is bridged
-- to Supabase Auth (Google OAuth) rather than the plaintext-password model
-- this table's username/password_hash columns were originally sketched for.

create extension if not exists pgcrypto;

create table app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  display_name text not null,
  exclude_keywords text default '',
  created_at timestamptz not null default now()
);
s
-- Replaces every "Claimed - <name>" tab AND the Disconnected tab AND the
-- legacy Leads tab -- all one table now, since a real WHERE clause makes
-- per-teammate tabs unnecessary. `status` distinguishes "claimed" (active
-- pipeline) from "disconnected" (dead) -- no more separate destination
-- sheet to move rows between.
create table leads (
  id uuid primary key default gen_random_uuid(),
  npi text not null,
  claimed_by uuid references app_users(id),
  claimed_at timestamptz not null default now(),

  -- lead data (from CsvExport.CSV_COLUMNS)
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

  -- tracking columns
  status text not null default 'new',
  status_updated_by uuid references app_users(id),
  status_updated_at timestamptz,
  notes text,
  reminder_at timestamptz,

  is_disconnected boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_leads_npi on leads(npi);
create index idx_leads_claimed_by on leads(claimed_by) where not is_disconnected;
create unique index idx_leads_npi_claimed_by on leads(npi, claimed_by); -- one claim per person per NPI

-- Replaces the "Notes" column's append-only call-log behavior with a real
-- table -- SheetsStore's addLeadNote was already timestamped/append-only in
-- spirit, this just makes that a real one-row-per-note model instead of one
-- growing text blob.
create table lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  note text not null,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

-- Replaces the Taxonomies tab.
create table taxonomies (
  id uuid primary key default gen_random_uuid(),
  facility_type text not null,
  code text,
  description text,
  enabled boolean not null default false
);

-- Replaces the SearchProgress tab.
create table search_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  filter_fingerprint text not null,
  variant_skips jsonb not null default '{}',
  seen_npis text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (user_id, filter_fingerprint)
);

-- Replaces the Suggestions tab.
create table suggestions (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  submitted_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

-- Replaces EnrichmentCache.
create table enrichment_cache (
  cache_key text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
