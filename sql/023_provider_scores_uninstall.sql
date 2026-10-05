-- DME Desk Prospector: remove the stored fit scores (sql/023) and get the space back.
-- MANUAL ONLY: review before execution. The agent never executes SQL against Supabase.
--
-- Searches keep working: with the stored scores gone they use the live path
-- (slower on a small database machine, identical results). The small helper
-- functions that search_providers_v2() calls (provider_scores_usable,
-- provider_scores_filter_sql, provider_score_weights, search_score_index_status)
-- are left in place on purpose: they answer "not usable" when the tables are
-- missing, and dropping them would break the search.
--
-- To restore search_providers_v2() to its exact sql/022 form as well, re-run
-- sql/022_search_speed.sql afterwards.

begin;

-- Triggers first, so no data load can reach a function whose table is gone.
drop trigger if exists provider_scores_stale_npi on public.npi_records;
drop trigger if exists provider_scores_stale_npi_truncate on public.npi_records;
drop trigger if exists provider_scores_stale_cms on public.npi_cms_enrichment;
drop trigger if exists provider_scores_stale_cms_truncate on public.npi_cms_enrichment;

drop table if exists public.provider_scores;
drop table if exists public.provider_scores_state;

drop function if exists public.provider_scores_mark_stale();
drop function if exists public.refresh_provider_scores(jsonb, text[]);
drop function if exists public.finish_provider_scores_refresh(timestamptz);

commit;

-- The freed space returns to the table's own file immediately (the table is
-- dropped, not emptied). Check:
-- select pg_size_pretty(pg_database_size(current_database()));
