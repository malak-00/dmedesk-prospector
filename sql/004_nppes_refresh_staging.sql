-- DME Desk Prospector: NPPES refresh staging.
-- MANUAL ONLY: review against the live schema before execution.
--
-- Staging is deliberately separate from `npi_records`. A malformed,
-- truncated, or partial release must never be able to partially overwrite
-- the live provider source -- it lands here first, gets counted and
-- verified, and only then does a separate transactional apply step compare
-- canonical values, write `provider_field_history`, and update
-- `npi_records`.
--
-- Written by: scripts/nppes_ingest (see scripts/README.md).
-- Columns mirror that tool's staging row exactly; the names follow the
-- fakeNPI-compatible names already used by `npi_records` so the eventual
-- apply step is close to a 1:1 copy.

create table if not exists public.nppes_refresh_staging (
  refresh_run_id uuid not null references public.refresh_runs(id) on delete cascade,
  npi text not null,
  source_row_number integer,

  -- Identity
  name text,
  normalized_name text,
  enumerationtype text,
  isorganization boolean,
  status text,
  replacement_npi text,

  -- Practice location
  address_line1 text,
  address_line2 text,
  address_city text,
  address_state text,
  address_postal_code text,
  phone text,
  fax text,

  -- Taxonomy: the primary code plus every populated slot, so a later
  -- re-filter doesn't need the source file again.
  taxonomy_code text,
  taxonomy_codes text[] not null default '{}'::text[],

  -- Authorized official (a Tier 1 identity-grouping signal)
  authorizedofficial_firstname text,
  authorizedofficial_lastname text,
  authorizedofficial_title text,
  authorizedofficial_phone text,

  -- Dates
  enumeration_date date,
  lastupdated date,
  deactivation_date date,
  reactivation_date date,
  certification_date date,

  created_at timestamptz not null default now(),

  -- One row per NPI per run. The ingestion CLI already rejects duplicate
  -- NPIs within a release; this makes that a database guarantee rather
  -- than a promise the loader keeps.
  primary key (refresh_run_id, npi)
);

create index if not exists idx_nppes_refresh_staging_npi
  on public.nppes_refresh_staging(npi);
create index if not exists idx_nppes_refresh_staging_run
  on public.nppes_refresh_staging(refresh_run_id);
-- Supports the apply step's "which NPIs in this run are already known"
-- join against npi_records.
create index if not exists idx_nppes_refresh_staging_run_state
  on public.nppes_refresh_staging(refresh_run_id, address_state);

comment on table public.nppes_refresh_staging is
  'Normalized NPPES release rows awaiting comparison/apply. Written by scripts/nppes_ingest; never read by the app at runtime.';
comment on column public.nppes_refresh_staging.status is
  'active | deactivated, derived from the deactivation/reactivation dates in the release.';
comment on column public.nppes_refresh_staging.phone is
  'First valid 10-digit number from the source cell, matching the identity-grouping phone rule.';

-- Same posture as the identity tables: the service-role Worker/CLI path is
-- the only intended access route; browser roles get nothing.
alter table public.nppes_refresh_staging enable row level security;
revoke all on public.nppes_refresh_staging from anon, authenticated;

-- Read-only verification. Run after every ingest; every count should be 0
-- except the last, which should match the manifest's staged_rows.
--
-- 1. Duplicate NPIs within a run (should be impossible -- the PK enforces it)
-- select refresh_run_id, npi, count(*)
--   from public.nppes_refresh_staging group by 1, 2 having count(*) > 1;
--
-- 2. Rows with an unusable NPI
-- select count(*) from public.nppes_refresh_staging
--   where npi !~ '^[0-9]{10}$';
--
-- 3. Staged rows not attached to a run
-- select count(*) from public.nppes_refresh_staging s
--   left join public.refresh_runs r on r.id = s.refresh_run_id
--   where r.id is null;
--
-- 4. Row count per run, newest first -- compare against the manifest
-- select r.id, r.source, r.source_version, r.status, r.row_count,
--        count(s.npi) as staged_rows, r.started_at
--   from public.refresh_runs r
--   left join public.nppes_refresh_staging s on s.refresh_run_id = r.id
--  where r.source = 'nppes'
--  group by r.id order by r.started_at desc limit 10;
