-- DME Desk Prospector: where does a claim spend its time? READ-ONLY. Changes nothing.
-- Run each numbered query on its own in the Supabase SQL Editor and send back the output.
--
-- Background: claim_leads() (sql/010, 011, 014) works out "does this look like a lead another rep already
-- holds?" in step 3. To do that it calls identity_candidate_keys() once for EVERY active lead that belongs to
-- someone else (the "others" CTE), on every claim and every "Send to Sheet" check, however few leads are being
-- claimed. That work grows with the whole team's claimed leads, not with the claim. These queries measure it,
-- and test a set-based version that should give exactly the same rows.

-- 1. How big is that set, and how are the calls doing right now? (instant)
select count(*) filter (where claimed_by is not null and not is_disconnected) as active_claimed_leads,
       count(distinct claimed_by) filter (where claimed_by is not null and not is_disconnected) as reps_with_leads
  from public.leads;

select calls, round(mean_exec_time) as mean_ms, round(max_exec_time) as max_ms,
       case when query like '%p_dry_run%' then 'dry run (Send to Sheet check)' else 'real claim' end as kind
  from pg_stat_statements
 where query like '%p_leads%'
 order by calls desc limit 4;

-- 2. TIME OF TODAY'S METHOD: the "others" step as claim_leads runs it. Read "Execution Time" at the bottom.
explain (analyze, timing off, summary on)
select count(*) from (
  select distinct on (l.npi, l.claimed_by)
         l.npi, l.claimed_by, l.group_id, l.company_name, k.name_key, k.state_key, k.official_key, k.phone_key
    from public.leads l
   cross join lateral public.identity_candidate_keys(jsonb_build_object(
     'npi', l.npi, 'name', l.company_name, 'state', l.state, 'phone', l.phone,
     'officialName', case when l.contact_source = 'nppes' then l.contact_name end,
     'officialPhone', case when l.contact_source = 'nppes' then l.contact_phone end)) k
   where not l.is_disconnected and l.claimed_by is not null
   order by l.npi, l.claimed_by, l.claimed_at desc nulls last
) others;

-- 3. TIME OF THE SET-BASED METHOD: same inputs, same key functions, no per-lead function call.
explain (analyze, timing off, summary on)
select count(*) from (
  select distinct on (l.npi, l.claimed_by)
         l.npi, l.claimed_by, l.group_id, l.company_name,
         public.identity_name_key(s.name) as name_key,
         public.identity_state_key(s.state) as state_key,
         public.identity_official_key(s.first_name, s.last_name) as official_key,
         public.identity_phone_key(s.phone, s.official_phone) as phone_key
    from public.leads l
    left join public.npi_records r on r.npi = btrim(coalesce(l.npi, ''))
   cross join lateral (select
           case when r.npi is not null then r.name else l.company_name end as name,
           case when r.npi is not null then r.address_state else l.state end as state,
           case when r.npi is not null then r.authorizedofficial_firstname
                else case when l.contact_source = 'nppes' then l.contact_name end end as first_name,
           case when r.npi is not null then r.authorizedofficial_lastname else null end as last_name,
           case when r.npi is not null then r.phone else l.phone end as phone,
           case when r.npi is not null then r.authorizedofficial_phone
                else case when l.contact_source = 'nppes' then l.contact_phone end end as official_phone) s
   where not l.is_disconnected and l.claimed_by is not null
   order by l.npi, l.claimed_by, l.claimed_at desc nulls last
) others;

-- 4. ARE THEY THE SAME? Expect only_in_current = 0 and only_in_set_based = 0 (and equal row counts).
--    If either is not 0, the set-based version is NOT equivalent and must not be used.
with current_method as (
  select distinct on (l.npi, l.claimed_by)
         l.npi, l.claimed_by, l.group_id, l.company_name, k.name_key, k.state_key, k.official_key, k.phone_key
    from public.leads l
   cross join lateral public.identity_candidate_keys(jsonb_build_object(
     'npi', l.npi, 'name', l.company_name, 'state', l.state, 'phone', l.phone,
     'officialName', case when l.contact_source = 'nppes' then l.contact_name end,
     'officialPhone', case when l.contact_source = 'nppes' then l.contact_phone end)) k
   where not l.is_disconnected and l.claimed_by is not null
   order by l.npi, l.claimed_by, l.claimed_at desc nulls last
), set_based as (
  select distinct on (l.npi, l.claimed_by)
         l.npi, l.claimed_by, l.group_id, l.company_name,
         public.identity_name_key(s.name) as name_key,
         public.identity_state_key(s.state) as state_key,
         public.identity_official_key(s.first_name, s.last_name) as official_key,
         public.identity_phone_key(s.phone, s.official_phone) as phone_key
    from public.leads l
    left join public.npi_records r on r.npi = btrim(coalesce(l.npi, ''))
   cross join lateral (select
           case when r.npi is not null then r.name else l.company_name end as name,
           case when r.npi is not null then r.address_state else l.state end as state,
           case when r.npi is not null then r.authorizedofficial_firstname
                else case when l.contact_source = 'nppes' then l.contact_name end end as first_name,
           case when r.npi is not null then r.authorizedofficial_lastname else null end as last_name,
           case when r.npi is not null then r.phone else l.phone end as phone,
           case when r.npi is not null then r.authorizedofficial_phone
                else case when l.contact_source = 'nppes' then l.contact_phone end end as official_phone) s
   where not l.is_disconnected and l.claimed_by is not null
   order by l.npi, l.claimed_by, l.claimed_at desc nulls last
)
select (select count(*) from current_method) as current_rows,
       (select count(*) from set_based) as set_based_rows,
       (select count(*) from (select * from current_method except select * from set_based) a) as only_in_current,
       (select count(*) from (select * from set_based except select * from current_method) b) as only_in_set_based;
