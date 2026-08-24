-- Read-only duplicate audit for the public.leads library.
-- The Python runner executes this inside a read-only transaction.
-- Phone values are normalized by keeping digits only; company names are
-- normalized by uppercasing and removing punctuation/spacing.

with normalized as (
  select
    l.id,
    l.npi,
    l.company_name,
    l.phone,
    l.contact_phone,
    l.state,
    l.city,
    l.postal_code,
    l.contact_name,
    l.contact_title,
    l.email,
    l.status,
    l.is_disconnected,
    l.claimed_at,
    l.created_at,
    l.updated_at,
    l.claimed_by,
    coalesce(u.display_name, u.username, l.claimed_by::text) as owner,
    upper(regexp_replace(coalesce(l.company_name, ''), '[^A-Za-z0-9]', '', 'g')) as company_key,
    upper(regexp_replace(coalesce(l.state, ''), '[^A-Za-z]', '', 'g')) as state_key,
    regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') as phone_key,
    regexp_replace(coalesce(l.contact_phone, ''), '[^0-9]', '', 'g') as contact_phone_key
  from public.leads l
  left join public.app_users u on u.id = l.claimed_by
), marked as (
  select
    n.*,
    count(*) over (partition by nullif(npi, '')) as npi_count,
    count(*) over (partition by nullif(company_key, ''), nullif(state_key, '')) as company_state_count,
    count(*) over (partition by nullif(state_key, ''), nullif(phone_key, '')) as state_phone_count,
    count(*) over (partition by nullif(state_key, ''), nullif(contact_phone_key, '')) as state_contact_phone_count
  from normalized n
)
select
  id, npi, company_name, state, city, postal_code, phone, contact_phone,
  contact_name, contact_title, email, status, is_disconnected, claimed_at,
  created_at, updated_at, claimed_by, owner,
  npi_count, company_state_count, state_phone_count, state_contact_phone_count,
  concat_ws('; ',
    case when npi_count > 1 then 'duplicate_npi' end,
    case when company_state_count > 1 then 'duplicate_company_state' end,
    case when state_phone_count > 1 and nullif(phone_key, '') is not null then 'duplicate_state_phone' end,
    case when state_contact_phone_count > 1 and nullif(contact_phone_key, '') is not null then 'duplicate_state_contact_phone' end
  ) as duplicate_reasons,
  company_key, state_key, phone_key, contact_phone_key
from marked
where npi_count > 1
   or company_state_count > 1
   or (state_phone_count > 1 and nullif(phone_key, '') is not null)
   or (state_contact_phone_count > 1 and nullif(contact_phone_key, '') is not null)
order by nullif(npi, ''), company_key, state_key, claimed_at, id;
