-- idx_leads_npi_claimed_by (from 0001_init.sql) is a plain unique index on
-- (npi, claimed_by) with no `is_disconnected` scoping -- once a user has
-- claimed+disconnected a given NPI once, that (npi, claimed_by) pair is
-- permanently used up: re-claiming that NPI later, or the Prospect view's
-- "Send to Disconnected" inserting a fresh disconnected row for it, both
-- hit a raw "duplicate key value violates unique constraint" error. The
-- real invariant this index should enforce is "one ACTIVE claim per person
-- per NPI", not "ever claimed, ever" -- a disconnected row shouldn't block
-- the same NPI from being claimed or disconnected again later.

drop index if exists public.idx_leads_npi_claimed_by;

create unique index idx_leads_npi_claimed_by_active on public.leads (npi, claimed_by)
  where not is_disconnected;
