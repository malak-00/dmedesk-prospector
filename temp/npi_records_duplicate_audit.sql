-- Run after loading the export as public.npi_records.
-- Phone normalization keeps the first 10-digit number in mixed/multiple-phone cells.
with normalized as (
  select
    r.*,
    upper(regexp_replace(coalesce(r.name, ''), '[^A-Za-z0-9]', '', 'g')) as company_key,
    upper(regexp_replace(coalesce(r.address_state, ''), '[^A-Za-z]', '', 'g')) as state_key,
    coalesce((regexp_match(regexp_replace(coalesce(r.phone, ''), '[^0-9]', '', 'g'), '(?:^1)?([0-9]{10})'))[1], '') as phone_key,
    coalesce((regexp_match(regexp_replace(coalesce(r.authorizedofficial_phone, ''), '[^0-9]', '', 'g'), '(?:^1)?([0-9]{10})'))[1], '') as authorized_phone_key
  from public.npi_records r
), marked as (
  select n.*,
    count(*) over (partition by nullif(npi, '')) as npi_count,
    count(*) over (partition by nullif(company_key, ''), nullif(state_key, '')) as company_state_count,
    count(*) over (partition by nullif(state_key, ''), nullif(phone_key, '')) as state_phone_count,
    count(*) over (partition by nullif(state_key, ''), nullif(authorized_phone_key, '')) as state_authorized_phone_count
  from normalized n
)
select *,
  concat_ws('; ',
    case when npi_count > 1 then 'duplicate_npi' end,
    case when company_state_count > 1 then 'duplicate_company_state' end,
    case when state_phone_count > 1 and phone_key <> '' then 'duplicate_state_phone' end,
    case when state_authorized_phone_count > 1 and authorized_phone_key <> '' then 'duplicate_state_authorized_phone' end
  ) as duplicate_reasons,
  (npi_count > 1 or company_state_count > 1
   or (state_phone_count > 1 and phone_key <> '')
   or (state_authorized_phone_count > 1 and authorized_phone_key <> '')) as duplicate_flag
from marked
order by duplicate_flag desc, npi;
