-- Provider history storage optimization and retention review.
--
-- This file is intentionally non-destructive. It contains review queries and
-- commented maintenance statements only. Do not run this file as a migration
-- without selecting and approving an explicit retention cutoff.

-- Read-only preview. Replace the value below with an explicitly approved
-- cutoff in the caller's query tool; this statement does not mutate data.
-- SELECT id, npi, field_name, created_at, refresh_run_id
-- FROM public.provider_field_history
-- WHERE created_at < :approved_cutoff
-- ORDER BY created_at ASC;

-- Optional sizing preview for the selected history slice.
-- SELECT count(*) AS rows_before_cutoff,
--        pg_size_pretty(sum(pg_column_size(h))::bigint) AS estimated_row_bytes
-- FROM public.provider_field_history AS h
-- WHERE h.created_at < :approved_cutoff;

-- Destructive statement intentionally disabled. Execute only after an export,
-- an explicit retention decision, and caller verification of the cutoff.
-- DELETE FROM public.provider_field_history
-- WHERE created_at < :approved_cutoff;

-- Staging cleanup is intentionally disabled. Only use the exact processed or
-- completed status values confirmed from the live staging schema, and only
-- after confirming retries/recovery do not depend on those rows.
-- DELETE FROM public.nppes_refresh_staging
-- WHERE status IN ('processed', 'completed')
--   AND completed_at < :approved_cutoff;

-- Space reclamation guidance (never execute automatically from this file):
-- * Regular VACUUM can make deleted space reusable but usually does not shrink
--   the physical relation.
-- * VACUUM (ANALYZE) public.provider_field_history;
-- * VACUUM FULL public.provider_field_history; -- exclusive lock; controlled use only
-- Run vacuum only after an approved, verified cleanup and during a maintenance
-- window. Never run VACUUM FULL on production as part of application deploy.
