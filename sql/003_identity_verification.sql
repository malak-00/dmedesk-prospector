-- Read-only checks for the identity backfill and completion criteria.

select count(*) as total_leads,
       count(*) filter (where group_id is null) as leads_without_group
from public.leads;

select npi, count(*) as membership_rows
from public.lead_group_members
group by npi
having count(*) <> 1;

select l.npi, count(*) as active_owner_count
from public.leads l
where not l.is_disconnected and l.claimed_by is not null
group by l.npi
having count(distinct l.claimed_by) > 1;

select l.group_id, count(distinct l.claimed_by) as active_owner_count,
       array_agg(distinct l.claimed_by) as owners
from public.leads l
where not l.is_disconnected and l.claimed_by is not null
group by l.group_id
having count(distinct l.claimed_by) > 1
order by active_owner_count desc;

select l.id, l.npi
from public.leads l
left join public.lead_ownership_events e
  on e.lead_id = l.id and e.event_type = 'claimed'
where l.claimed_by is not null and e.id is null;

select grouping_tier, count(*)
from public.lead_groups
group by grouping_tier
order by grouping_tier;

