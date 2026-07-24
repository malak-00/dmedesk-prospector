-- 0002 enabled RLS on `leads` with SELECT/INSERT/UPDATE policies but no
-- DELETE policy -- Postgres RLS defaults to denying any operation with no
-- matching policy, so returnClaimedLeadsToProspect's `.delete()` (see
-- vercel/lib/services/leadsService.js) silently affected zero rows: no
-- error, just `returnedCount: 0`, so "Return to Prospect" looked like it
-- did nothing.

create policy "delete own leads" on public.leads for delete
  using (claimed_by = auth.uid());
