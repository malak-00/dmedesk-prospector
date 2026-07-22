# Implementation plan: Apps Script mirror script (Google Sheets → Supabase)

## This reverses an earlier decision — read this first

`MIGRATION_TO_VERCEL_SUPABASE.md` section 6 explicitly chose a **one-time
CSV export/import**, not a live mirror, reasoning that a mirror only earns
its complexity if both stores need to stay in sync — and a single cutover
doesn't. That reasoning still holds for a pure "export once, cut over"
plan.

What's changed: `CUTOVER_PLAN.md` step 7 wants a **parallel-run period**
(old Apps Script app and new Vercel app both live for a few days, as a
safety net) — and during that window, teammates might keep using the OLD
app if the new one isn't fully trusted yet, which means new claims/notes/
status changes would keep landing in the Google Sheet, not Supabase. A
one-time export taken before that window starts would miss all of that.

**So: a mirror is justified specifically for the parallel-run window, not
as a permanent architecture.** It should be turned off the moment the old
app is decommissioned (`CUTOVER_PLAN.md` step 7.5) — treat it as scaffolding
for the migration, not a feature.

**Before building this, confirm with the user that a parallel-run window
bridging both live systems is actually what they want** — the alternative
(what section 6 originally assumed) is: pick a cutover moment, export once,
never write to the Sheet again after that moment, accept a hard switch.
That's simpler and has no mirror to build/maintain/decommission at all. If
the user is fine with a hard switch, skip this entire plan.

## Direction: Sheets → Supabase only, never the reverse

The new app is the one being tested/trusted; teammates who've already
switched write to Supabase directly (via the Vercel API), which has its own
RLS-enforced correctness. There is no scenario in this migration where
Supabase writes need to flow back into the Sheet — building that direction
too would double the complexity for no purpose. If a teammate is unsure
which app to use during the parallel-run window, they should default to the
OLD (Apps Script) app until told otherwise, precisely so this one-directional
mirror stays sufficient.

## Design

### Trigger

Google Sheets `onEdit(e)` and `onFormSubmit(e)` triggers are unreliable for
this: `onEdit` fires per-cell-edit (noisy, hard to batch, easy to miss a
multi-cell paste), and neither trigger fires for edits made via the Apps
Script API itself (i.e., `SheetsStore.js`'s own writes from the live app
wouldn't reliably re-trigger the mirror in a predictable order relative to
the user's own action).

**Recommended: a time-driven trigger (e.g. every 5 minutes) that scans for
rows changed since its last run**, not an edit-triggered one. Simpler to
reason about, immune to trigger-storm issues from bulk operations (a
"Search more" claiming 20 rows at once), and idempotent by construction if
done right (see below).

### Detecting "changed since last run"

Add a `LastSyncedAt` marker (a script property, not a sheet cell) storing
the timestamp of the last successful sync. Compare against each row's own
"last modified" signal:

- `SheetsStore.js`'s tracking columns (`status`, `Status Updated At`, etc.)
  already have a natural "last touched" timestamp for most row changes —
  reuse `Status Updated At` for claimed-leads rows, and add a genuinely new
  `Last Synced At` helper column if there's no existing timestamp that
  covers every mutation (e.g. a bare claim with no status change yet, or a
  notes-only edit that doesn't touch `Status Updated At`).
- Simplest robust option: add ONE new column, `Mirror Dirty` (boolean),
  set to `TRUE` by every write path in `SheetsStore.js` (claim, status
  update, note, reminder, disconnect, return-to-prospect), and cleared to
  `FALSE` by the mirror script after a successful push. This makes "what
  changed" a trivial column filter instead of timestamp comparison, and
  survives clock skew between the Sheet and the script's own timestamps.

### Push logic (per sync run)

1. For each sheet this app manages (`Claimed - <name>` tabs, `Disconnected`,
   `Taxonomies`, `Suggestions`) — NOT `Users` (Google OAuth means there's
   nothing there to mirror; ignore that tab entirely):
2. Read every row where `Mirror Dirty = TRUE`.
3. For each row, `UPSERT` into the matching Supabase table via the
   `service_role` key (bypasses RLS — this script is server-to-server, not
   acting as any particular user) and `@supabase/supabase-js`'s REST
   endpoint, or a plain `UrlFetchApp.fetch` against
   `https://pcvyrkisvvtiteoiuplg.supabase.co/rest/v1/<table>` with a
   `Prefer: resolution=merge-duplicates` header for the upsert semantics.
4. **The `old username → app_users.id` mapping problem
   (`MIGRATION_TO_VERCEL_SUPABASE.md` section 6, point 3) applies here
   too** — every row's `claimed_by`/`status_updated_by`/etc. needs to
   resolve to a real `app_users.id`, which only exists once that teammate
   has signed in with Google at least once. Maintain a small mapping table
   (a new sheet tab, `UserIdMapping`, columns `OldUsername | GoogleEmail |
   NewAppUserId`) that an admin fills in once per teammate after their
   first Google sign-in, and have the mirror script look up through it.
   Rows for a teammate who hasn't signed in yet should be **skipped, not
   dropped** — leave `Mirror Dirty = TRUE` so they're retried on the next
   run once the mapping exists.
5. On successful upsert for a row, set `Mirror Dirty = FALSE`.
6. On failure (network, a rejected upsert, mapping still missing), leave
   `Mirror Dirty = TRUE` and log the failure (`Logger.log` at minimum;
   consider writing failures to a dedicated `MirrorErrors` tab so they're
   visible without digging through Apps Script's execution log UI) — never
   silently drop a row.

### Idempotency

Upsert (not insert) on a stable key is what makes re-running a failed sync
safe. For `leads`, the natural key is `(npi, claimed_by)` — matches the
existing `idx_leads_npi_claimed_by_active` unique index already in
`supabase/migrations/0002_enable_rls_and_google_oauth_bridge.sql`. For
`taxonomies`/`suggestions`, there's no natural business key from the Sheet
side (no stable id column there) — either add one (a UUID column in the
Sheet, generated on first mirror) or accept that a retried sync after a
partial failure could duplicate a `taxonomies`/`suggestions` row, and dedupe
those two tables manually before decommissioning (small enough tables that
this is a one-time cleanup, not worth over-engineering the mirror for).

### Security

The `service_role` key must live in Apps Script's **Script Properties**
(same place `FOURSQUARE_SERVICE_API_KEY` etc. already live), never
hardcoded in the script source — this key bypasses RLS entirely, so
treat it with the same care as `vercel/.env.example` already documents for
the Vercel side.

### Turning it off

Delete the time-driven trigger (Apps Script editor → Triggers) the moment
`CUTOVER_PLAN.md` step 7.5 happens (Apps Script deployment gets deleted
anyway, but the trigger is a separate thing from the deployment and won't
necessarily get cleaned up automatically — check explicitly). Leaving it
running after the Sheet stops being the source of truth risks a
stale/conflicting write landing in Supabase from someone still editing the
old Sheet directly (e.g. via the Sheets UI, bypassing the app entirely,
which the mirror can't distinguish from a legitimate app write).

## What this plan deliberately does NOT cover

- Any reverse sync (Supabase → Sheets) — see "Direction" above.
- Migrating the `Users` tab — irrelevant under Google OAuth.
- A real-time/webhook-based mirror (e.g. Supabase Realtime, or Apps
  Script's edit-trigger) — the time-driven poll is simpler and sufficient
  for a short parallel-run window; don't build the more complex version
  unless the polling interval genuinely proves too slow in practice.

## Open question to resolve before building this

Confirm the parallel-run window's expected length (a few days? a week?) —
that shapes whether a 5-minute poll interval is fine or whether something
tighter is actually needed, and whether the `UserIdMapping` tab's manual
per-teammate step is an acceptable amount of friction for the number of
teammates involved.
