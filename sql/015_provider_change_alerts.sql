-- DME Desk Prospector: what a monthly NPPES refresh means for claimed leads.
-- MANUAL ONLY: review against the live schema before execution.
-- Run after 007 (and 001). Safe to run before the first refresh.
--
-- 007 updates npi_records and records every changed field in
-- provider_field_history. It deliberately stops there: it never touches
-- leads. This file is the second half of a refresh --
-- apply_provider_changes_to_leads(run_id) --
--
--   * refreshes the provider-owned snapshot on active leads (company name,
--     phone, address, specialty, NPPES last-updated, and the contact only
--     when it came from NPPES). It never touches claimed_by, claimed_at,
--     status, notes, reminder_at or is_disconnected -- the rep's own work.
--   * raises one pending 'provider_data_changed' review event per claimed
--     lead whose provider changed in a way a rep has to know about: phone,
--     authorized official, organization name, city/state, status or
--     deactivation. Everything else stays in provider_field_history.
--   * flags the events where the identity keys themselves moved (name,
--     phone, official) with metadata.group_review, because the lead's group
--     may no longer be right. Groups are never re-cut silently: an admin
--     decides, the same way they decide a Tier 2/3 match.
--
-- Batched and resumable like the apply itself: each call takes the next
-- p_batch_size NPIs in NPI order and records how far it got on the run, so
-- an interrupted sync continues where it stopped and a finished one is a
-- no-op. Re-running it never raises the same alert twice.

begin;

-- Which lead column mirrors which npi_records column. Both sides are probed
-- against the live schema, because npi_records has gone through more than
-- one column spelling (address_postalcode vs address_postal_code) and a
-- lead column may simply not be there.
create or replace function public.nppes_lead_snapshot_map()
returns table (lead_column text, record_column text, lead_type text)
language sql
stable
set search_path = public, pg_temp
as $$
  with wanted (lead_column, candidates) as (
    values
      ('company_name', array['name']),
      ('phone', array['phone']),
      ('address_line1', array['address_line1']),
      ('city', array['address_city']),
      ('state', array['address_state']),
      ('postal_code', array['address_postal_code', 'address_postalcode']),
      ('specialty', array['taxonomy_description']),
      ('nppes_last_updated', array['lastupdated'])
  ), lead_cols as (
    select attname, format_type(atttypid, atttypmod) as coltype from pg_attribute
     where attrelid = 'public.leads'::regclass and attnum > 0 and not attisdropped
  ), record_cols as (
    select attname from pg_attribute
     where attrelid = 'public.npi_records'::regclass and attnum > 0 and not attisdropped
  )
  select w.lead_column,
         (select c from unnest(w.candidates) c where c in (select attname from record_cols) limit 1),
         (select lc.coltype from lead_cols lc where lc.attname = w.lead_column)
    from wanted w
   where w.lead_column in (select attname from lead_cols)
     and exists (select 1 from unnest(w.candidates) c where c in (select attname from record_cols))
$$;

-- The changes a rep is told about. Everything else is history only.
create or replace function public.nppes_escalating_fields()
returns text[]
language sql
immutable
as $$
  select array['name', 'phone', 'authorizedofficial_firstname', 'authorizedofficial_lastname',
               'authorizedofficial_title', 'authorizedofficial_phone', 'address_city', 'address_state',
               'status', 'deactivation_date', 'replacement_npi']
$$;

-- The subset that changes how a lead groups, so the group needs a look.
create or replace function public.nppes_regrouping_fields()
returns text[]
language sql
immutable
as $$
  select array['name', 'phone', 'authorizedofficial_firstname', 'authorizedofficial_lastname',
               'authorizedofficial_phone']
$$;

-- An admin's decision about an alert. It lives here rather than on the event
-- because lead_ownership_events is append-only -- the same reason identity
-- decisions have their own table (sql/009). The event records what NPPES
-- did; this records what we did about it.
create table if not exists public.provider_change_decisions (
  event_id uuid primary key references public.lead_ownership_events(id) on delete cascade,
  decision text not null check (decision in ('approved', 'dismissed')),
  note text,
  decided_by uuid not null references public.app_users(id),
  decided_at timestamptz not null default now()
);

create index if not exists idx_provider_change_decisions_decided_at
  on public.provider_change_decisions(decided_at desc);

alter table public.provider_change_decisions enable row level security;
revoke all on public.provider_change_decisions from anon, authenticated;

-- One alert per lead per refresh run, so a resumed or repeated sync can't
-- raise the same thing twice.
create unique index if not exists idx_lead_ownership_events_provider_change_once
  on public.lead_ownership_events (npi, source_ref)
  where event_type = 'provider_data_changed' and source = 'nppes_refresh';

create or replace function public.apply_provider_changes_to_leads(p_run_id uuid, p_batch_size integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.refresh_runs%rowtype;
  v_batch text[];
  v_map record;
  v_set_list text := '';
  v_updated integer := 0;
  v_alerts integer := 0;
  v_remaining integer;
  v_cursor text;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 20000 then
    raise exception 'batch size must be between 1 and 20000';
  end if;

  select * into v_run from public.refresh_runs where id = p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if v_run.source <> 'nppes' then
    raise exception 'refresh run % is not an NPPES run', p_run_id;
  end if;
  -- npi_records has to be up to date first: the snapshot is copied from it.
  if coalesce(v_run.metadata->>'apply_state', '') <> 'applied' then
    raise exception 'refresh run % has not finished applying (apply_state %)',
      p_run_id, coalesce(v_run.metadata->>'apply_state', 'none');
  end if;

  v_cursor := coalesce(v_run.metadata->>'lead_sync_last_npi', '');

  select array_agg(npi order by npi) into v_batch
    from (select distinct npi from public.provider_field_history
           where refresh_run_id = p_run_id and npi > v_cursor
           order by npi limit p_batch_size) b;

  if v_batch is null then
    update public.refresh_runs
       set metadata = metadata || jsonb_build_object('lead_sync_state', 'complete', 'lead_sync_finished_at', now())
     where id = p_run_id;
    return jsonb_build_object('processed', 0, 'leads_updated', 0, 'alerts', 0, 'remaining', 0, 'done', true);
  end if;

  -- 1. The provider-owned snapshot, and nothing else.
  for v_map in select * from public.nppes_lead_snapshot_map()
  loop
    v_set_list := v_set_list || case when v_set_list = '' then '' else ', ' end
                  || format('%I = r.%I::text::%s', v_map.lead_column, v_map.record_column, v_map.lead_type);
  end loop;

  if v_set_list <> '' then
    execute format(
      'update public.leads l set %s
         from public.npi_records r
        where r.npi = l.npi and l.npi = any($1) and not l.is_disconnected', v_set_list)
      using v_batch;
    get diagnostics v_updated = row_count;
  end if;

  -- The scraped contact is someone the rep found; only an NPPES-sourced one
  -- is the authorized official and follows the release.
  update public.leads l
     set contact_name = nullif(btrim(concat_ws(' ', r.authorizedofficial_firstname, r.authorizedofficial_lastname)), ''),
         contact_title = r.authorizedofficial_title,
         contact_phone = r.authorizedofficial_phone
    from public.npi_records r
   where r.npi = l.npi
     and l.npi = any(v_batch)
     and not l.is_disconnected
     and l.contact_source = 'nppes';

  -- 2. Alerts, for claimed leads only: an unclaimed lead has nobody to tell.
  with changes as (
    select h.npi,
           jsonb_agg(jsonb_build_object('field', h.field_name, 'oldValue', h.old_value, 'newValue', h.new_value)
                     order by h.field_name) as fields,
           array_agg(distinct h.field_name) as field_names
      from public.provider_field_history h
     where h.refresh_run_id = p_run_id
       and h.npi = any(v_batch)
       and h.field_name = any(public.nppes_escalating_fields())
     group by h.npi
  )
  insert into public.lead_ownership_events
    (lead_id, npi, group_id, event_type, reason, source, source_ref, requires_review, review_status, metadata)
  select l.id, l.npi, l.group_id, 'provider_data_changed',
         'NPPES changed ' || array_to_string(c.field_names, ', ') || ' for a claimed lead',
         'nppes_refresh', p_run_id::text, true, 'pending',
         jsonb_build_object(
           'changes', c.fields,
           'fields', to_jsonb(c.field_names),
           'group_review', exists (select 1 from unnest(c.field_names) f
                                    where f = any(public.nppes_regrouping_fields())),
           'owner_user_id', l.claimed_by,
           'refresh_run_id', p_run_id)
    from changes c
    join public.leads l on l.npi = c.npi and not l.is_disconnected and l.claimed_by is not null
   where not exists (
     select 1 from public.lead_ownership_events e
      where e.npi = c.npi and e.source_ref = p_run_id::text
        and e.event_type = 'provider_data_changed' and e.source = 'nppes_refresh');
  get diagnostics v_alerts = row_count;

  v_cursor := v_batch[array_length(v_batch, 1)];
  select count(distinct npi) into v_remaining
    from public.provider_field_history
   where refresh_run_id = p_run_id and npi > v_cursor;

  update public.refresh_runs
     set metadata = metadata || jsonb_build_object(
           'lead_sync_state', case when v_remaining = 0 then 'complete' else 'syncing' end,
           'lead_sync_last_npi', v_cursor,
           'lead_sync_alerts', coalesce((metadata->>'lead_sync_alerts')::integer, 0) + v_alerts,
           'lead_sync_leads_updated', coalesce((metadata->>'lead_sync_leads_updated')::integer, 0) + v_updated)
       || case when v_remaining = 0 then jsonb_build_object('lead_sync_finished_at', now()) else '{}'::jsonb end
   where id = p_run_id;

  return jsonb_build_object(
    'processed', array_length(v_batch, 1),
    'leads_updated', v_updated,
    'alerts', v_alerts,
    'remaining', v_remaining,
    'done', v_remaining = 0);
end;
$$;

-- What an admin sees: one row per pending provider change, newest first,
-- with the owner it affects and the lead as it stands now.
create or replace view public.provider_change_queue as
select e.id as event_id,
       e.npi,
       e.group_id,
       e.created_at,
       e.reason,
       e.metadata->'changes' as changes,
       coalesce((e.metadata->>'group_review')::boolean, false) as group_review,
       l.id as lead_id,
       l.company_name,
       l.city,
       l.state,
       l.status as lead_status,
       l.claimed_by as owner_user_id,
       u.display_name as owner_display_name,
       e.source_ref as refresh_run_id
  from public.lead_ownership_events e
  left join public.leads l on l.id = e.lead_id
  left join public.app_users u on u.id = l.claimed_by
 where e.event_type = 'provider_data_changed'
   and e.requires_review
   and e.review_status = 'pending'
   and not exists (select 1 from public.provider_change_decisions d where d.event_id = e.id)
 order by e.created_at desc;

-- Acknowledging a change is a decision, so it is recorded as one.
-- 'dismissed' means "seen, no action"; 'approved' means the admin acted on it
-- (reassigned, regrouped, released). The alert itself is never edited or
-- deleted -- it leaves the queue because a decision now exists beside it.
create or replace function public.resolve_provider_change(
  p_event_id uuid, p_reviewer_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.lead_ownership_events%rowtype;
  v_decision public.provider_change_decisions%rowtype;
begin
  if p_decision not in ('approved', 'dismissed') then
    raise exception 'decision must be approved or dismissed, not %', p_decision;
  end if;
  if not exists (select 1 from public.app_users where id = p_reviewer_id and is_admin) then
    raise exception 'user % is not an admin', p_reviewer_id;
  end if;

  select * into v_event from public.lead_ownership_events
   where id = p_event_id and event_type = 'provider_data_changed';
  if not found then raise exception 'provider change event % does not exist', p_event_id; end if;

  select * into v_decision from public.provider_change_decisions where event_id = p_event_id;
  if found then
    return jsonb_build_object('eventId', p_event_id, 'decision', v_decision.decision,
                             'decidedBy', v_decision.decided_by, 'alreadyDecided', true);
  end if;

  insert into public.provider_change_decisions (event_id, decision, note, decided_by)
  values (p_event_id, p_decision, nullif(btrim(coalesce(p_note, '')), ''), p_reviewer_id)
  on conflict (event_id) do nothing;

  select * into v_decision from public.provider_change_decisions where event_id = p_event_id;
  return jsonb_build_object('eventId', p_event_id, 'decision', v_decision.decision,
                            'decidedBy', v_decision.decided_by,
                            'alreadyDecided', v_decision.decided_by is distinct from p_reviewer_id);
end;
$$;

revoke all on function public.apply_provider_changes_to_leads(uuid, integer) from public, anon, authenticated;
grant execute on function public.apply_provider_changes_to_leads(uuid, integer) to service_role;
revoke all on function public.resolve_provider_change(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.resolve_provider_change(uuid, uuid, text, text) to service_role;
revoke all on public.provider_change_queue from public, anon, authenticated;
grant select on public.provider_change_queue to service_role;
grant select, insert on public.provider_change_decisions to service_role;

commit;

-- Verification (read-only):
-- select lead_column, record_column, lead_type from public.nppes_lead_snapshot_map();
-- select count(*) from public.provider_change_queue;
-- select decision, count(*) from public.provider_change_decisions group by decision;
-- select id, metadata->>'lead_sync_state' as sync, metadata->>'lead_sync_alerts' as alerts
--   from public.refresh_runs where source = 'nppes' order by started_at desc limit 5;
