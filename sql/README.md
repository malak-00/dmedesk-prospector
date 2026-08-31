# Supabase SQL bundle

These files are ordered and intended for manual execution in the Supabase SQL
Editor by the project owner. The agent does not execute them against Supabase.

Before running `002_identity_backfill.sql`, confirm that `public.npi_records`
has the columns referenced there. The repository's existing audit SQL confirms
`npi`, `name`, `address_state`, `authorizedofficial_firstname`,
`authorizedofficial_lastname`, `phone`, and `authorizedofficial_phone`; the
backfill also uses optional address fields only through a separately marked
adaptation point.

Run one file at a time and stop if its verification query reports an error.
`003_identity_verification.sql` is read-only and should be saved with the
execution results.

