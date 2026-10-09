# Saved Search Persistence Plan

**Status:** Proposed — no implementation or production database change has been made.  
**Date:** 2026-10-09

## Objective

Keep each signed-in user's named **Saved searches** when the static frontend is
updated, when browser storage is cleared, and when they sign in on another
device.  A user's saved searches remain private to that user.

## Confirmed current state

- `docs/app.js` labels this feature “Saved searches (this browser only)” and
  stores all presets under `localStorage["dmeProspectorSavedSearches"]`.
- The saved preset includes its name, the current filter values, and an
  optional availability snapshot used for the “new since last time” badge.
- The live Worker already authenticates requests and has the user's stable
  `app_users.id` in `session.id`; `search_progress` already proves that
  user-specific search state is stored server-side.
- Browser-only data that was already cleared cannot be reconstructed. Data
  still in a user's browser can be migrated the first time that person opens
  the upgraded app.

## Assumptions and scope

This plan treats “searches” as the named presets in the **Saved searches**
menu, rather than an audit/history of every Search button click. It retains
the current per-user limit of 12 presets and existing name-replaces-name
behavior. Search-progress bookmarks remain in `search_progress` and are out
of scope.

If the intended outcome is also a team-visible search library or a searchable
history of every executed search, add that as a separate, explicitly designed
feature; it has different privacy, retention, and volume requirements.

## Target design

```text
Browser Saved-search UI
        |
        v  authenticated HTTPS
Cloudflare Worker: /saved-searches
        |
        v  service-role access, constrained to session.id
Supabase saved_searches (one owner's private presets)
```

The database is the source of truth after migration. The browser may keep a
short-lived migration marker/cache, but must not be the only copy.

## Data contract and migration

Add a new reviewed, manual-only SQL migration (next available number:
`sql/038_saved_searches.sql`) that is rerun-safe and only adds data.

`public.saved_searches`:

| Column | Purpose |
|---|---|
| `id bigint generated always as identity primary key` | Stable UI/API identity. |
| `user_id uuid not null references app_users(id)` | Owner; never supplied as an authority by the client. |
| `name text not null` | Display name, 1–40 trimmed characters. |
| `filter_values jsonb not null` | Validated saved-filter shape only; no session token or arbitrary UI data. |
| `snapshot jsonb null` | `{ unclaimed, at }`, validated before write. |
| `created_at`, `updated_at timestamptz` | Ordering and conflict resolution. |

Constraints and indexes:

- unique case-insensitive name per user (for example a unique index on
  `user_id, lower(name)`);
- index on `(user_id, updated_at desc, id desc)`;
- RLS enabled and all direct grants revoked from `public`, `anon`, and
  `authenticated`, consistent with Worker service-role tables;
- no destructive backfill: the client migrates each currently reachable
  browser-local list after sign-in.

The migration file will include read-only verification queries and an explicit
note that it must be reviewed and run manually in Supabase before deploying
the dependent Worker/frontend.

## Worker changes

Create `worker/src/repos/savedSearchesRepo.js`, using the request session's
`id` for every query. It will:

1. Validate and normalize names, filter keys/types, and optional snapshots;
   reject malformed or oversized payloads with a 400 response.
2. List only the caller's presets, newest `updated_at` first.
3. Create or replace by name atomically using the database's per-user unique
   constraint; preserve a single row identity where practical.
4. Update a snapshot only for a preset the caller owns.
5. Delete only a preset the caller owns, by stable `id`.
6. Accept one bounded bulk-import/upsert request for the legacy local list,
   capped at 12 and returning the canonical server list.

Add authenticated routes in `worker/src/index.js`:

- `GET /saved-searches`
- `POST /saved-searches` (create/replace)
- `POST /saved-searches/import` (one-time local migration)
- `PATCH /saved-searches/:id/snapshot`
- `DELETE /saved-searches/:id`

The route handlers will never accept a user ID, and errors will use the
existing `{ success, data } / { success, status, error }` response shape.

## Frontend changes

Replace `readSavedSearches()` / `writeSavedSearches()` in `docs/app.js` with
an in-memory list populated from `GET /saved-searches` after authentication.
Render, apply, delete, save, and badge refresh actions will operate by server
record ID rather than fragile array positions.

Legacy migration behavior on first signed-in load:

1. Read the existing local list defensively.
2. Fetch the server list.
3. If local entries exist, call the bounded import endpoint. The server merges
   by normalized name and keeps the newer `updated_at` value; local data is
   treated as newer only for this one migration because it has no trustworthy
   historical modification timestamp.
4. Render the returned canonical list, then remove the old local-storage key
   only after a successful server response. Leave it intact on network/API
   failure and show a non-blocking retry message.

The 12-search limit will be enforced by the Worker, with the frontend mirroring
it for a fast message. When a newly saved search exceeds the limit, retain the
current behavior of keeping the 12 most recently updated presets, but have the
API return an explicit `pruned` result so the user is told which older preset
was removed. This is safer than a silent browser-only `slice()`.

## Validation and rollout

1. Add repository tests for validation, ownership isolation, case-insensitive
   replacement, limit/pruning, snapshot update, deletion, and import merging.
2. Add frontend tests or focused unit seams for: initial load, migration retry,
   no deletion of legacy data before acknowledgement, and rendering by stable
   ID.
3. Run Worker unit tests and syntax/static checks locally. Run `git diff
   --check`; do not run production SQL or deploy as part of implementation
   verification.
4. Have an authorized operator manually review and run
   `sql/038_saved_searches.sql` in the intended Supabase project, then verify
   the read-only queries.
5. Deploy Worker and frontend together only after the schema exists. Keep the
   import endpoint available for at least one normal release cycle so users
   who have not opened the upgraded app can migrate their local presets.
6. Ask users to manually test in their browser: save a preset, refresh, sign
   out/in, open another browser/device, and deploy a frontend update. Confirm
   the preset persists and remains invisible to another account.

## Acceptance criteria

- A named search saved by User A survives a frontend release, browser refresh,
  sign-out/in, and a second browser/device.
- User B cannot list, change, snapshot, or delete User A's presets.
- Existing browser-local presets migrate without loss when the API is
  available; a failed migration leaves the legacy local copy retryable.
- Saving a duplicate name deterministically replaces only that user's preset.
- Search buttons and server-side `search_progress` behavior remain unchanged.

## Safety and rollback

The SQL is additive and no existing search-progress, leads, claims, or audit
tables are modified. No saved-search record is deleted except by its owner or
the documented 12-item retention rule after an explicit save. If a frontend
rollback is required, the old client still reads its legacy local list; the
server copy remains intact for the upgraded client. Do not remove the import
endpoint or legacy migration code until adoption has been reviewed.
