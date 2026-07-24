-- The leads migrated in from the old Google Sheets data (already-claimed and
-- already-disconnected leads) went through a spreadsheet at some point,
-- which can leave 10-digit NPIs formatted differently than a fresh NPPES
-- lookup returns them (a trailing ".0" from Excel/Sheets treating the NPI
-- as a number, stray whitespace, etc). getClaimedNpis() did an exact string
-- match with no normalization, so a migrated "1234567890.0" never matched a
-- freshly-searched "1234567890" and the actively-claimed lead resurfaced in
-- Prospect. The application code now normalizes NPIs on every read/write
-- (see normalizeNpi() in vercel/lib/services/leadsService.js) -- this
-- one-time backfill cleans up the rows that were already written before
-- that existed.

update public.leads
set npi = regexp_replace(regexp_replace(trim(npi), '\.0+$', ''), '\D', '', 'g')
where npi <> regexp_replace(regexp_replace(trim(npi), '\.0+$', ''), '\D', '', 'g');
