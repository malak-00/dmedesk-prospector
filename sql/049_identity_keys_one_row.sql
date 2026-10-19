-- DME Desk Prospector: tell the planner identity_candidate_keys() returns ONE row.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Run any time. Rerun-safe. It changes ONE FUNCTION'S PLANNER ESTIMATE
-- (ALTER FUNCTION ... ROWS): the function body, its results, every table and all
-- data are untouched, and nothing is dropped.
--
-- Why: identity_candidate_keys(jsonb) is a set-returning function that always
-- returns exactly one row per call, but Postgres assumes 1,000 by default. In
-- owned_group_npis() (run on every search round) 200 candidates were therefore
-- planned as 100,000 rows, so the planner hash-joined them against ALL of
-- lead_groups (~92,000 rows) and lead_group_members (~66,000), spilling to temp
-- files, instead of 200 index lookups. Measured on 200 real candidates: the
-- plan with ROWS 1 uses lead_groups_identity_key_key / idx_lead_group_members_npi
-- and writes no temp files; buffer reads for that part fell from ~8,500 to ~2,150.
--
-- The same wrong guess inflates other queries that call it: claim_leads()
-- (its "other users' active leads" step) and identity_review_candidates, whose
-- plan estimates ~71 billion rows (actual ~3,800) and times out the admin
-- match-review page. Those should plan better too; not yet measured.

begin;

alter function public.identity_candidate_keys(jsonb) rows 1;

commit;

-- Verification (read-only):
--   select proname, prorows from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'identity_candidate_keys';
--   expect prorows = 1
