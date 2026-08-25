-- Strict duplicate rule:
-- company name + state + authorized official + first normalized 10-digit phone
with normalized as (
  select
    r.*,
    upper(regexp_replace(coalesce(r.name, ''), '[^A-Za-z0-9]', '', 'g')) as company_key,
    upper(regexp_replace(coalesce(r.address_state, ''), '[^A-Za-z]', '', 'g')) as state_key,
    upper(regexp_replace(concat_ws(' ', r.authorizedofficial_firstname, r.authorizedofficial_lastname), '[^A-Za-z0-9]', '', 'g')) as authorized_official_key,
    coalesce(
      (regexp_match(regexp_replace(coalesce(r.phone, ''), '[^0-9]', '', 'g'), '(?:^1)?([0-9]{10})'))[1],
      (regexp_match(regexp_replace(coalesce(r.authorizedofficial_phone, ''), '[^0-9]', '', 'g'), '(?:^1)?([0-9]{10})'))[1],
      ''
    ) as phone_key
  from public.npi_records r
), grouped as (
  select n.*, count(*) over (
    partition by company_key, state_key, authorized_official_key, phone_key
  ) as strict_duplicate_count
  from normalized n
  where company_key <> '' and state_key <> '' and authorized_official_key <> '' and phone_key <> ''
)
select *, strict_duplicate_count > 1 as strict_duplicate_flag
from grouped
where strict_duplicate_count > 1
order by company_key, state_key, authorized_official_key, phone_key, npi;
