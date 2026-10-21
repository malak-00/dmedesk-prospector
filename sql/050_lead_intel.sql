-- BD Lead Prospector: structured call fields ("call intel") on any lead, claimed or not.
-- MANUAL ONLY: review against the live schema before execution. The agent
-- never executes SQL against Supabase without being told to run this file.
-- Rerun-safe. Creates one small table; nothing existing is touched.
--
-- What a rep learns on a call used to live only in free-text notes. These few fields keep it in a form the
-- team can search, reuse in the call brief, and count:
--   current_biller   who handles their billing or back office today (a company name, "in-house", ...)
--   gatekeeper       the name of the person who answers the phone or screens calls
--   direct_line      the best direct number for the decision maker
--   email            the decision maker's email
--   patient_volume   a rough size, as they said it ("about 80 a month")
--   objection        the main reason they gave for not signing, from a short pick-list
--
-- One row per provider (NPI), shared by the whole team: the latest value wins, and the row records who changed
-- it last and when. Size: about 250 bytes a lead; 50,000 leads is around 12 MB.
-- Without this file the app keeps working: the call intel boxes say they are not installed yet.

begin;

create table if not exists public.lead_intel (
  npi text primary key,
  current_biller text check (char_length(current_biller) <= 80),
  gatekeeper text check (char_length(gatekeeper) <= 80),
  direct_line text check (char_length(direct_line) <= 30),
  email text check (char_length(email) <= 120),
  patient_volume text check (char_length(patient_volume) <= 60),
  objection text check (objection in ('price', 'in-house', 'happy with current', 'bad timing', 'not the decision maker', 'no need', 'other')),
  updated_by uuid references public.app_users (id),
  updated_at timestamptz not null default now()
);

create index if not exists lead_intel_objection on public.lead_intel (objection) where objection is not null;

-- Service role only, like the other team tables.
alter table public.lead_intel enable row level security;
revoke all on table public.lead_intel from public, anon, authenticated;

commit;

-- Verification (read-only):
-- select objection, count(*) from public.lead_intel where objection is not null group by 1 order by 2 desc;
