-- Read-only prerequisite check. Save the result before running any other SQL.

select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('app_users', 'leads', 'npi_records')
order by table_name;

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('app_users', 'leads', 'npi_records')
order by table_name, ordinal_position;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('app_users', 'leads', 'npi_records')
order by tablename, indexname;

-- Required for 002_identity_backfill.sql. This returns one row per missing
-- column; it must return zero rows before the backfill is run.
with required(column_name) as (
  values
    ('npi'), ('name'), ('address_state'),
    ('authorizedofficial_firstname'), ('authorizedofficial_lastname'),
    ('phone'), ('authorizedofficial_phone')
)
select r.column_name
from required r
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = 'npi_records'
 and c.column_name = r.column_name
where c.column_name is null
order by r.column_name;

