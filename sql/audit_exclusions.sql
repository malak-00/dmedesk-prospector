-- READ-ONLY audit: how many npi_records / leads match each exclusion keyword.
-- Not a migration: nothing here writes. Paste into the Supabase SQL editor.
-- Matching is the same rule search uses: name ILIKE '%term%'.
-- Plan: documentation/plans/exclusion_audit_and_filtering_plan.md (phase 3).
--
-- Edit the term list in the first CTE of each query, then run the queries one at
-- a time (each is a single statement). If one hits the statement timeout, run
-- it with fewer terms. The sample terms are placeholders, NOT the real list.

-- 1) Per keyword: matches in npi_records, how many are active, and how many are
--    leads held by someone / not held / disconnected.
with terms(term) as (
  values ('hospital'), ('pharmacy'), ('dentist'), ('salon'),
         ('oxygen'), ('sleep'), ('therapy')     -- DME-sensitive: review samples (query 3)
), hits as (
  select t.term, r.npi, r.status, r.deactivation_date
    from terms t
    join public.npi_records r on r.name ilike '%' || t.term || '%'
)
select h.term,
       count(*)                                                             as npi_records,
       count(*) filter (where h.deactivation_date is null
                          and upper(coalesce(h.status,'A')) in ('A','ACTIVE')) as active_in_search,
       count(*) filter (where exists (select 1 from public.leads l
                          where l.npi = h.npi and l.claimed_by is not null
                            and not l.is_disconnected))                     as held_by_a_rep,
       count(*) filter (where exists (select 1 from public.leads l
                          where l.npi = h.npi and l.claimed_by is null))    as unclaimed_leads
  from hits h
 group by h.term
 order by npi_records desc;

-- 2) Overall: distinct providers matched by ANY term, against the table total.
with terms(term) as (
  values ('hospital'), ('pharmacy'), ('dentist'), ('salon'),
         ('oxygen'), ('sleep'), ('therapy')
)
select count(*) as distinct_providers_matched,
       (select count(*) from public.npi_records) as total_npi_records
  from public.npi_records r
 where r.name ilike any (select '%' || term || '%' from terms);

-- 3) Samples for one term, to eyeball false positives (change the term).
select r.npi, r.name, r.address_state, r.status
  from public.npi_records r
 where r.name ilike '%oxygen%'
 order by random()
 limit 40;

-- 4) Rep-held leads that would be affected (never touched by any cleanup
--    without an admin decision). Change the pattern list to match query 1.
select l.npi, l.company_name, l.claimed_by, l.claimed_at
  from public.leads l
 where l.claimed_by is not null and not l.is_disconnected
   and l.company_name ilike any (array['%hospital%','%pharmacy%','%dentist%','%salon%'])
 order by l.claimed_at desc nulls last
 limit 200;
