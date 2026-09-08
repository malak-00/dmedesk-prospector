-- Safe replacement for 002_identity_backfill.sql.
-- MANUAL ONLY. Run after 001_identity_schema.sql.
-- This version never overwrites an existing reviewed NPI membership.

begin;

do $$
begin
  if not exists (select 1 from public.npi_records limit 1) then
    raise exception 'public.npi_records is empty or unavailable; stop before backfill';
  end if;
end $$;

create temporary table identity_backfill_candidates on commit drop as
with source_rows as (
  select distinct on (l.npi)
    l.npi,
    r.name,
    r.address_state,
    r.authorizedofficial_firstname,
    r.authorizedofficial_lastname,
    r.phone,
    r.authorizedofficial_phone
  from public.leads l
  left join public.npi_records r on r.npi = l.npi
  order by l.npi
), normalized as (
  select
    npi, name, address_state,
    authorizedofficial_firstname, authorizedofficial_lastname, phone,
    upper(regexp_replace(coalesce(name, ''), '[^A-Za-z0-9]', '', 'g')) as name_key,
    upper(regexp_replace(coalesce(address_state, ''), '[^A-Za-z]', '', 'g')) as state_key,
    upper(regexp_replace(concat_ws(' ', authorizedofficial_firstname, authorizedofficial_lastname), '[^A-Za-z0-9]', '', 'g')) as official_key,
    coalesce(
      (regexp_match(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '(?:^1)?([0-9]{10})'))[1],
      (regexp_match(regexp_replace(coalesce(authorizedofficial_phone, ''), '[^0-9]', '', 'g'), '(?:^1)?([0-9]{10})'))[1],
      ''
    ) as phone_key
  from source_rows
)
select
  npi, name, address_state, authorizedofficial_firstname,
  authorizedofficial_lastname, phone,
  case when name_key <> '' and state_key <> '' and official_key <> '' and phone_key <> ''
    then 'strict:' || name_key || ':' || state_key || ':' || official_key || ':' || phone_key
    else 'singleton:' || npi end as identity_key,
  case when name_key <> '' and state_key <> '' and official_key <> '' and phone_key <> ''
    then 'strict' else 'singleton' end as grouping_tier,
  nullif(phone_key, '') as normalized_phone_key
from normalized;

insert into public.lead_groups
  (identity_key, canonical_name, state, authorized_official, phone_key, grouping_tier)
select identity_key,
       min(name),
       min(address_state),
       nullif(min(concat_ws(' ', authorizedofficial_firstname, authorizedofficial_lastname)), ''),
       min(normalized_phone_key),
       min(grouping_tier)
from identity_backfill_candidates
group by identity_key
on conflict (identity_key) do update set
  canonical_name = coalesce(public.lead_groups.canonical_name, excluded.canonical_name),
  state = coalesce(public.lead_groups.state, excluded.state),
  authorized_official = coalesce(public.lead_groups.authorized_official, excluded.authorized_official),
  phone_key = coalesce(public.lead_groups.phone_key, excluded.phone_key),
  updated_at = now();

insert into public.lead_group_members
  (group_id, npi, relationship_type, review_status, evidence)
select g.id, c.npi, 'primary', 'approved',
       jsonb_build_object('backfill', true, 'grouping_tier', c.grouping_tier, 'identity_key', c.identity_key)
from identity_backfill_candidates c
join public.lead_groups g on g.identity_key = c.identity_key
on conflict (npi) do nothing;

update public.leads l
set group_id = m.group_id
from public.lead_group_members m
where m.npi = l.npi
  and l.group_id is distinct from m.group_id;

insert into public.lead_ownership_events
  (lead_id, npi, group_id, event_type, to_user_id, reason, source, metadata)
select l.id, l.npi, l.group_id, 'claimed', l.claimed_by,
       'Historical ownership backfill', 'identity_backfill',
       jsonb_build_object('is_disconnected', l.is_disconnected, 'claimed_at', l.claimed_at)
from public.leads l
where l.claimed_by is not null
  and not exists (
    select 1 from public.lead_ownership_events e
    where e.lead_id = l.id and e.event_type = 'claimed'
  );

commit;

