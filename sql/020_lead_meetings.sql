-- DME Desk Prospector: one upcoming meeting per claimed lead.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase.
-- Run after 001 and 013. Additive and rerun-safe: only adds nullable columns,
-- one check constraint set, and a trigger. No existing row is changed.
--
-- A rep books a meeting from the Claimed lead card: date and time, how long,
-- how long before to be reminded, the contact's email, and their own "opener"
-- notes (opening line, talking points, questions to ask). It lives on the lead
-- row beside notes, status and reminder_at because it is the owner's working
-- data for that lead, not a shared record. Only the next meeting is kept;
-- each booking or cancellation is also written into the call log (notes), so
-- history is not lost when a meeting is rescheduled.
--
-- Releasing or reassigning a lead clears the meeting, so one rep's opener
-- notes and contact email never carry over to the next owner. That is done
-- by a trigger rather than by editing release_claimed_leads() (sql/013), so
-- re-running 013 later cannot undo it, and it also covers an admin
-- reassigning a conflict.

begin;

alter table public.leads
  add column if not exists meeting_at timestamptz,
  add column if not exists meeting_duration_min integer,
  add column if not exists meeting_remind_before_min integer,
  add column if not exists meeting_email text,
  add column if not exists meeting_opener_notes text;

-- Bounds mirror the Worker's validation (worker/src/lib/meetings.js) so a
-- direct write cannot store something the app would refuse.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_meeting_duration_check') then
    alter table public.leads add constraint leads_meeting_duration_check
      check (meeting_duration_min is null or meeting_duration_min between 15 and 240);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_meeting_remind_check') then
    alter table public.leads add constraint leads_meeting_remind_check
      check (meeting_remind_before_min is null or meeting_remind_before_min between 5 and 10080);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_meeting_text_check') then
    alter table public.leads add constraint leads_meeting_text_check
      check (length(coalesce(meeting_email, '')) <= 254
         and length(coalesce(meeting_opener_notes, '')) <= 2000);
  end if;
end $$;

create or replace function public.clear_meeting_on_owner_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.claimed_by is distinct from old.claimed_by then
    new.meeting_at := null;
    new.meeting_duration_min := null;
    new.meeting_remind_before_min := null;
    new.meeting_email := null;
    new.meeting_opener_notes := null;
  end if;
  return new;
end $$;

drop trigger if exists leads_clear_meeting_on_owner_change on public.leads;
create trigger leads_clear_meeting_on_owner_change
  before update of claimed_by on public.leads
  for each row execute function public.clear_meeting_on_owner_change();

comment on column public.leads.meeting_at is 'Start of the owner''s next meeting with this lead; null when none is booked.';
comment on column public.leads.meeting_opener_notes is 'Owner''s private opener / talking points for the meeting.';

commit;

-- Verification (read-only):
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'leads' and column_name like 'meeting_%' order by 1;
-- select tgname from pg_trigger where tgname = 'leads_clear_meeting_on_owner_change';
