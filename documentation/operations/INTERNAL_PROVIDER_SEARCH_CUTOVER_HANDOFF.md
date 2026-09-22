# Internal Provider Search Cutover Handoff

**Prepared:** 2026-09-22  
**Purpose:** Continue the NPPES-to-DME-Desk provider-search cutover from a
laptop with Docker/Supabase tooling available.

## Current state

The Worker already supports two provider sources:

| Setting | Source | Code path |
|---|---|---|
| `mirror` (current default) | fakeNPI over HTTP | `worker/src/services/nppes.js` |
| `dmedesk` | DME Desk `public.npi_records` via RPC | `worker/src/services/providerSearch.js` |

The selector is implemented in
`worker/src/services/providerSource.js`. The live application still uses the
mirror because `NPI_SOURCE` is absent or not set to `dmedesk`.

Do not use `PROVIDER_SOURCE`; the code only reads `NPI_SOURCE`.

## Remaining cutover work

### 1. Install and verify the database search function

Run `sql/018_provider_search.sql` against the DME Desk Supabase project after
reviewing it against the live schema. It creates/replaces:

```sql
public.search_providers(jsonb, integer, integer)
public.taxonomy_description_for(text)
```

The SQL file includes read-only verification queries at the end. Confirm:

```sql
select npi, name, city, state, total_count
from public.search_providers('{"state":"VA"}'::jsonb, 5, 0);
```

Also verify stable paging:

```sql
select npi from public.search_providers('{"state":"VA"}'::jsonb, 5, 0)
intersect
select npi from public.search_providers('{"state":"VA"}'::jsonb, 5, 5);
```

Expected intersection: zero rows.

### 2. Verify taxonomy coverage before switching

```sql
select facility_type, code, description, enabled
from public.taxonomies
where enabled = true
order by facility_type;
```

The main DME row must resolve to:

```text
Code:        332B00000X
Description: Durable Medical Equipment & Medical Supplies
Enabled:     true
```

The Worker fix in `worker/src/repos/taxonomiesRepo.js` now supports legacy rows
whose `description` is blank by falling back to `facility_type`, but a row still
needs a valid `code` to avoid NPPES taxonomy rejection and to use internal
exact-code search.

### 3. Compare both sources

Before switching, use the Admin **Search source → Compare sources** panel, or
call:

```text
GET /admin/search-compare?state=VA&taxonomyDescription=Durable%20Medical%20Equipment
```

Test at least:

- State-only comparison.
- State plus main DME taxonomy.
- Organization-name search.
- Multiple states/taxonomies.
- Paging/search-more behavior.
- Exact NPI lookup.

Coverage gaps need explanation: the internal table may be behind the mirror's
latest refresh. The comparison endpoint reports coverage and timing; it does
not compare page intersections because the two sources sort differently.

### 4. Switch the Worker

Set this plain Cloudflare Worker variable in the dashboard:

```text
NPI_SOURCE=dmedesk
```

The source selector is designed to switch without a code deployment. If a
deployment is made at the same time, run the Worker smoke tests afterward.

Rollback is:

```text
NPI_SOURCE=mirror
```

An unrecognized or missing value also safely resolves to `mirror`.

## Important dependencies and caveats

- `providerSearch.js` expects the `search_providers()` RPC to be installed.
- Internal results use the normalized shape expected by `docs/app.js`; no
  frontend rewrite should be necessary.
- The internal SQL path reads Medicare data from `npi_cms_enrichment`; verify
  that table has current data before relying on claims-based ranking.
- `npi_records` freshness depends on the NPPES ingest/apply workflow. The
  ingestion CLI exists, but the broader refresh/apply process remains a
  separate tracked workstream.
- Do not remove `FAKENPI_BASE_URL` until the internal source has passed real
  search comparisons and a rollback window has been agreed.

## Files already implemented

- `worker/src/services/providerSource.js` — source switch.
- `worker/src/services/providerSearch.js` — internal RPC client and response
  normalization.
- `worker/src/repos/taxonomiesRepo.js` — taxonomy lookup, including the
  legacy facility-type fallback.
- `sql/018_provider_search.sql` — internal search function and indexes.
- `worker/README.md` — operational switch instructions.

## Files/documents that were updated in this handoff

- `documentation/plans/MASTER_PLAN.md`
- `sql/README.md`
- `documentation/operations/WORKLOG.md`

