# Supabase Free-Tier Support Services Plan

**Status:** Proposed. Supabase remains the authoritative production database.  
**Date:** 2026-10-09

## Objective

Preserve the Supabase free project's approximately 500 MB for the small,
transactional records that must be correct, while using complementary service
free tiers for large files, disposable caches, background work, backups,
observability, and safe development environments.

## Non-negotiable data boundary

**Supabase is the single production source of truth** for:

- `app_users`, authentication permissions, claims, leads, statuses, notes,
  reminders, and ownership audit records;
- `search_progress` and future `saved_searches` records;
- the searchable provider registry and the SQL functions that enforce claim
  and ownership rules.

No production database migration to Neon is part of this plan. No service
below may become the only copy of a claim, note, saved search, or ownership
decision.

## Target service map

| Service | Responsibility | Data rule |
|---|---|---|
| Supabase | Authoritative relational application data | Must be durable, queryable, and transactionally correct. |
| Cloudflare R2 | Raw NPPES files, CSV uploads/exports, avatar/attachment files, database-export archives | Store an object key and metadata in Supabase; never store a file blob in a lead or notes row. |
| Cloudflare KV | Short-lived read cache: repeat search results, territory/count responses, rate-limit counters | Cache only. A missing/expired key must cause a safe recomputation. |
| Upstash Redis | Optional shared cache, distributed rate limits, and short-lived integration locks | TTL required. Never store the only copy of business data. |
| Backblaze B2 | Independent off-site backup copy of reviewed Supabase exports and R2 archives | Write-once archive policy; restore is manual and verified. |
| Neon | Non-production preview/staging database and optional compact, non-authoritative reporting summaries | No live claims, notes, or production ownership writes. |
| PostHog / Sentry | Product analytics and error monitoring | Send minimized operational metadata; exclude passwords, tokens, and lead-note contents. |

## Delivery order

### Phase 1 — Protect Supabase capacity (first)

1. Measure current table/index sizes and produce a weekly size report; do not
   guess which table is consuming storage.
2. Define retention rules before moving data: keep application records in
   Supabase; archive source files and generated exports to R2.
3. Add R2 object-key references for future file uploads rather than adding
   `bytea`, base64, or large JSON blobs to Supabase tables.
4. Add lifecycle rules for temporary import/export objects and log every
   archival/export job.

**Acceptance:** the provider registry and transactional tables retain their
storage budget; large binary/source artifacts are no longer stored in
Supabase.

### Phase 2 — Add safe cache layers

1. Cache only expensive, read-only Worker responses in KV with explicit TTLs
   and versioned keys (`search:v1:…`).
2. Invalidate/bypass cache whenever a result depends on a claim, status, or
   other mutable ownership rule; stale cached ownership is never acceptable.
3. Use Upstash Redis only if KV's daily write limit or consistency model is a
   poor fit for rate limits/integration locks.
4. Measure cache hit rate, key count, write rate, and Worker fallbacks before
   expanding cache coverage.

**Acceptance:** cache outage/expiry affects response speed only—not data
correctness, permissions, or ownership.

### Phase 3 — Backup and observability

1. Produce a reviewed export of critical Supabase data on an agreed schedule;
   encrypt it before sending a secondary copy to B2.
2. Exercise a restore into an isolated test project before calling the backup
   process complete.
3. Add Sentry error reporting to the Worker/frontend and PostHog only for
   agreed product events. Scrub authorization headers, JWTs, passwords, full
   lead notes, and spreadsheet payloads.

**Acceptance:** a documented restore drill succeeds and alerts identify
Worker failures without exposing secrets or customer notes.

### Phase 4 — Neon as a support environment (no migration)

Use Neon for either or both of the following, not for production writes:

- **Preview/staging:** create a disposable branch for Worker/SQL development
  and test schema changes or new APIs without touching production Supabase.
- **Optional reporting sandbox:** load only aggregated, non-sensitive
  summaries (for example daily counts by status/state). It is never queried
  to decide a live claim and it is reproducible from Supabase.

Before any reporting export, define the fields, aggregation interval,
retention, privacy classification, and the one-way export job. Do not copy
raw notes, credentials, full customer context, or ownership events by
default.

**Acceptance:** deleting the Neon project cannot prevent the production app
from searching, claiming, saving notes, or restoring data.

## Deferred Neon setup runbook

Run this only when a Neon preview/reporting environment is approved. The
specified project and `production` branch must be confirmed to be the intended
non-authoritative Neon environment before `neon deploy` is run.

From the repository root:

```powershell
npm i -g neon@latest
neon login
neon skills -y
neon mcp -y
neon link --project-id aged-bonus-95431916 --branch production -y
neon config init
```

Then create/update `neon.ts`:

```ts
import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  preview: {
    buckets: {
      test: { access: "private" },
    },
    functions: {
      api: { name: "api", source: "./hello.ts" },
    },
  },
});
```

Create/update `hello.ts`:

```ts
export default async function hello(): Promise<Response> {
  return new Response("Hello from Neon Functions");
}
```

Deploy only after reviewing the resulting diff and Neon target:

```powershell
neon deploy
```

### Neon safety checklist

- Never copy Supabase production secrets into source files, Neon config, logs,
  or browser code.
- Use separate Neon credentials for a preview/reporting job and store them as
  deployment secrets, not in `.env` committed files.
- Do not point the current Worker at Neon. Its Supabase client, SQL RPCs,
  authentication, and claim rules continue to use Supabase.
- Record the Neon URL, branch purpose, owner, data classification, and deletion
  date in an operations note after setup.
- Treat `neon deploy` as an external deployment, not a local test command.

## Cost and capacity guardrails

- R2/KV/Queues and Neon free allocations can change; review current limits
  before enabling a new workload.
- Add billing alerts or hard usage caps wherever the provider permits them;
  a free tier should not be the only control against unexpected cost.
- Do not create multiple free Supabase projects to shard production data.
  Cross-project claims and audits would lose transactional consistency.
- When Supabase's provider registry/indexes—not files or caches—approach the
  free limit, upgrade its plan rather than moving only part of the live
  relational system.

## Definition of done

1. Supabase's table/index size report is available and reviewed.
2. Large files are in R2 with only references in Supabase.
3. Caches have TTL, safe fallback, metrics, and no authoritative records.
4. A restore drill from the independent backup is documented.
5. Neon is either unused or demonstrably non-authoritative; the live Worker
   has no Neon production dependency.

