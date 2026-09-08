-- DME Desk Prospector: identity grouping and append-only audit schema.
-- MANUAL ONLY: review against the live schema before execution.

create table if not exists public.lead_groups (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null unique,
  canonical_name text,
  state text,
  authorized_official text,
  phone_key text,
  grouping_tier text not null default 'singleton'
    check (grouping_tier in ('strict', 'singleton', 'review')),
  review_status text not null default 'not_required'
    check (review_status in ('not_required', 'pending', 'approved', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.lead_groups(id) on delete cascade,
  npi text not null,
  relationship_type text not null default 'primary'
    check (relationship_type in ('primary', 'alias', 'possible_duplicate', 'possible_successor', 'confirmed_successor')),
  review_status text not null default 'approved'
    check (review_status in ('approved', 'pending', 'dismissed')),
  evidence jsonb not null default '{}'::jsonb,
  reviewed_by uuid references public.app_users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (npi)
);

create index if not exists idx_lead_group_members_group_id
  on public.lead_group_members(group_id);
create index if not exists idx_lead_group_members_npi
  on public.lead_group_members(npi);

create table if not exists public.refresh_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('nppes', 'medicare')),
  source_version text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'staged'
    check (status in ('staged', 'applied', 'failed', 'cancelled')),
  row_count integer,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.lead_ownership_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  npi text not null,
  group_id uuid references public.lead_groups(id) on delete set null,
  event_type text not null
    check (event_type in ('claimed', 'reassigned', 'released', 'provider_data_changed', 'conflict_detected')),
  from_user_id uuid references public.app_users(id),
  to_user_id uuid references public.app_users(id),
  reason text,
  source text,
  source_ref text,
  approved_by uuid references public.app_users(id),
  requires_review boolean not null default false,
  review_status text not null default 'not_required'
    check (review_status in ('not_required', 'pending', 'approved', 'dismissed')),
  reviewed_by uuid references public.app_users(id),
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_lead_ownership_events_group_created
  on public.lead_ownership_events(group_id, created_at desc);
create index if not exists idx_lead_ownership_events_npi_created
  on public.lead_ownership_events(npi, created_at desc);
create index if not exists idx_lead_ownership_events_review
  on public.lead_ownership_events(review_status, created_at desc)
  where requires_review;

create table if not exists public.provider_field_history (
  id uuid primary key default gen_random_uuid(),
  npi text not null,
  field_name text not null,
  old_value jsonb,
  new_value jsonb,
  source text not null check (source in ('nppes', 'medicare')),
  refresh_run_id uuid references public.refresh_runs(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_provider_field_history_npi_created
  on public.provider_field_history(npi, created_at desc);
create index if not exists idx_provider_field_history_refresh
  on public.provider_field_history(refresh_run_id);

alter table public.leads
  add column if not exists group_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.leads'::regclass
      and conname = 'leads_group_id_fkey'
  ) then
    alter table public.leads
      add constraint leads_group_id_fkey
      foreign key (group_id) references public.lead_groups(id);
  end if;
end $$;

create index if not exists idx_leads_group_id on public.leads(group_id);

-- Audit tables are append-only. Mutable review fields belong on a separate
-- workflow table in a later phase; changing history would destroy evidence.
create or replace function public.reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'append-only audit table: % is immutable', TG_TABLE_NAME;
end;
$$;

drop trigger if exists lead_ownership_events_append_only on public.lead_ownership_events;
create trigger lead_ownership_events_append_only
before update or delete on public.lead_ownership_events
for each row execute function public.reject_audit_mutation();

drop trigger if exists provider_field_history_append_only on public.provider_field_history;
create trigger provider_field_history_append_only
before update or delete on public.provider_field_history
for each row execute function public.reject_audit_mutation();

-- The current Worker uses the service-role key and custom JWT auth, not
-- Supabase Auth. Keep these tables inaccessible to browser roles until the
-- explicit application/RLS contract is implemented.
alter table public.lead_groups enable row level security;
alter table public.lead_group_members enable row level security;
alter table public.refresh_runs enable row level security;
alter table public.lead_ownership_events enable row level security;
alter table public.provider_field_history enable row level security;

revoke all on public.lead_groups from anon, authenticated;
revoke all on public.lead_group_members from anon, authenticated;
revoke all on public.refresh_runs from anon, authenticated;
revoke all on public.lead_ownership_events from anon, authenticated;
revoke all on public.provider_field_history from anon, authenticated;
revoke all on function public.reject_audit_mutation() from public;

