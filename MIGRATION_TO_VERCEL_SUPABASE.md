# Migrating to Vercel + Supabase

A concrete plan to move off Google Apps Script + GitHub Pages + Google
Sheets onto Vercel (hosting) + Supabase (Postgres database + auth), starting
from exactly where this repo is today. Read `ARCHITECTURE.md` first if you
haven't — this doc assumes you know what `appscript/`, `docs/`, and
`backend/` each currently are.

## Current status (read this first)

This is no longer a plan for the future — sections 1-3 below are **done**,
on branch `claude/vercel-supabase-migration-l1fevn` ([PR #6](https://github.com/malak-00/dmedesk-prospector/pull/6),
deliberately not merged into `main` yet):

- **Supabase project**: `dmedesk-prospector` (ref `pcvyrkisvvtiteoiuplg`,
  `https://pcvyrkisvvtiteoiuplg.supabase.co`). Schema applied (the
  `app_users`-based version — see section 1's note), RLS enabled on every
  table, taxonomies seeded.
- **Auth**: Google OAuth via Supabase Auth, not the plaintext-password
  `app_users` model section 2 describes as the alternative. `app_users.id`
  is a foreign key into `auth.users(id)` — a Google login auto-creates its
  `app_users` row on first sign-in (see `vercel/lib/auth.js`). Google OAuth
  is configured in both Google Cloud Console and Supabase's dashboard
  (Authentication → Providers → Google), redirect URI
  `https://pcvyrkisvvtiteoiuplg.supabase.co/auth/v1/callback`.
- **Vercel project**: `dmedesk-prospector` (`prj_hGV86e3Not6U8fjhR9hZMJa73mVv`,
  team `malak`), Git-connected to this repo — **production branch must be
  `claude/vercel-supabase-migration-l1fevn`, root directory `vercel`** (it
  was briefly misconfigured to build from `main`, which has none of this
  code — if a deploy ever looks like it's serving nothing, check this
  first). Live at `https://dmedesk-prospector.vercel.app`. All env vars
  from section 3's table are set.
- **Verified working end-to-end**: `/api/health` (200), `/api/auth/google`
  (200, returns a real Supabase Google-OAuth authorize URL),
  `/api/leads` and `/api/taxonomies` (401 "Not signed in" when hit without
  a token — i.e. they reach the real auth-gated handler, not a 404).
- **Known gotcha already hit and fixed**: Vercel's plain (non-framework)
  Functions do **not** support the optional-catch-all `[[...action]]`
  filename syntax — that's Next.js-only. Routes needing a bare index (e.g.
  `GET /api/leads`) need a separate `index.js` alongside a required
  `[...action].js` for everything else. Also, `req.query`'s file-system
  dynamic-segment population isn't reliable for plain Functions either —
  `vercel/lib/http.js`'s `getActionSegments(req, basePath)` parses the
  action straight out of `req.url` instead. See the route files under
  `vercel/api/*` for the pattern.

Still **not** done: section 6 (data migration — CSV import is the chosen
approach, not an Apps Script mirror script, since this is meant to be a
one-time cutover, not continuous sync) and section 5/7's frontend rewire
(`docs/app.js` still targets Apps Script for everything except a gated
"Sign in with Google" test button — see `docs/config.js`'s `VERCEL_API_URL`).

**This is a real rewrite, not a config change.** Nothing here is a small
"point it at a new URL" task — every stateful service
(`SheetsStore`/`AuthService`/`TaxonomyService`/`SearchProgressService`)
reads/writes Google Sheets directly and has to be rewritten against SQL
queries instead. The read-only enrichment services (NPPES, Foursquare, OSM,
CMS, scoring) port over almost unchanged — most of them already exist in
`backend/src/services/` as a Node starting point. Budget the bulk of the
effort for the stateful pieces and the auth/session model, not the
NPPES/enrichment pipeline.

## Why this is worth doing

Everything in `ARCHITECTURE.md`'s "Known limitations" section goes away:

| Problem today | Fixed by |
|---|---|
| Apps Script's ~6-minute execution cap kills slow requests silently | Vercel functions (or a long-running Node process) don't have that cap |
| Every NPI lookup is a full-column linear scan (no indexes) | Postgres `WHERE npi = $1` with a real index |
| A CORS workaround (`?token=` query param, `text/plain` bodies) built entirely around what Apps Script can't do | Vercel sets real CORS headers; use real `Authorization: Bearer` headers and `application/json` bodies |
| Every response is HTTP 200 with a logical `status` field | Real HTTP status codes |
| No transactions (append-then-delete for moves) | Real Postgres transactions |
| Plaintext passwords, because there's no hashing tool available to a spreadsheet | Supabase Auth (bcrypt under the hood) or `bcrypt`/`argon2` in your own table |

## Target architecture

```
Browser (docs/ frontend, or move it into the Vercel project too)
   │  fetch("https://your-app.vercel.app/api/search/companies", {
   │    headers: { Authorization: `Bearer ${token}` }
   │  })
   ▼
Vercel (Node runtime — either Vercel Serverless Functions under /api,
        or backend/'s Express app via a Vercel adapter)
   │
   ├─ NppesService, FoursquareService, OsmService, CmsService,
   │  ScraperService (real cheerio again — Node, not Apps Script),
   │  ScoringService, AiBriefService
   │       → same external APIs as today, ported ~as-is from appscript/
   │
   └─ Supabase client (@supabase/supabase-js or plain `pg`)
          → Postgres tables replacing every Sheets tab (see schema below)
          → Supabase Auth replacing Users tab + CacheService sessions (optional
            but recommended)
```

You have two real choices for where the frontend lives — pick one, don't
run both:

- **Keep `docs/` on GitHub Pages**, just repoint `config.js`'s
  `APPS_SCRIPT_URL` (rename it — it's not Apps Script anymore) at your new
  Vercel API URL. Fastest path, smallest diff.
- **Move the frontend into the same Vercel project** as static files (or a
  real framework later) so there's one deployment, one domain, no
  cross-origin requests at all. Recommended if you're doing this rewrite
  anyway.

## 1. Create the Supabase project and schema — DONE

Applied to `pcvyrkisvvtiteoiuplg` as `supabase/migrations/0001_init.sql`
(this schema) followed by `0002_enable_rls_and_google_oauth_bridge.sql`
(RLS + the `auth.users` FK bridge described in the status section above).
The section below is kept as-is for reference/reproducing on a fresh
project — just note it now needs both migration files, not just this one.

```sql
-- Replaces the Users tab. If you use Supabase Auth (recommended, see
-- section 4), you likely don't need this table at all -- auth.users
-- already exists. Keep this only if you want app-specific fields
-- (display_name, exclude_keywords) beyond what Supabase Auth stores, or if
-- you're deferring the Supabase Auth switch and keeping your own login.
create table app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,           -- bcrypt, never plaintext
  display_name text not null,
  exclude_keywords text default '',
  created_at timestamptz not null default now()
);

-- Replaces every "Claimed - <name>" tab AND the Disconnected tab AND the
-- legacy Leads tab -- all one table now, since a real WHERE clause makes
-- per-teammate tabs unnecessary. `status` distinguishes "claimed" (active
-- pipeline) from "disconnected" (dead) -- no more separate destination
-- sheet to move rows between.
create table leads (
  id uuid primary key default gen_random_uuid(),
  npi text not null,
  claimed_by uuid references app_users(id),   -- or auth.users(id) if using Supabase Auth
  claimed_at timestamptz not null default now(),

  -- lead data (from CsvExport.CSV_COLUMNS)
  company_name text,
  phone text,
  website text,
  email text,
  address_line1 text,
  city text,
  state text,
  postal_code text,
  specialty text,
  contact_name text,
  contact_title text,
  contact_role text,
  contact_source text,
  additional_contacts_found text,
  rating numeric,
  score_value numeric,
  score_percentage numeric,
  data_sources text,
  medicare_claims numeric,
  medicare_beneficiaries numeric,
  medicare_payment numeric,
  contact_phone text,
  nppes_last_updated date,

  -- tracking columns
  status text not null default 'new',
  status_updated_by uuid references app_users(id),
  status_updated_at timestamptz,
  notes text,             -- consider a separate lead_notes table instead (see note below)
  reminder_at timestamptz,

  is_disconnected boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_leads_npi on leads(npi);
create index idx_leads_claimed_by on leads(claimed_by) where not is_disconnected;
create unique index idx_leads_npi_claimed_by on leads(npi, claimed_by); -- one claim per person per NPI

-- Replaces the "Notes" column's append-only call-log behavior with a real
-- table -- SheetsStore's addLeadNote was already timestamped/append-only in
-- spirit, this just makes that a real one-row-per-note model instead of
-- one growing text blob.
create table lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  note text not null,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

-- Replaces the Taxonomies tab.
create table taxonomies (
  id uuid primary key default gen_random_uuid(),
  facility_type text not null,
  code text,
  description text,        -- what actually gets sent to NPPES as taxonomy_description
  enabled boolean not null default false
);

-- Replaces the SearchProgress tab.
create table search_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  filter_fingerprint text not null,
  variant_skips jsonb not null default '{}',
  seen_npis text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (user_id, filter_fingerprint)
);

-- Replaces the Suggestions tab.
create table suggestions (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  submitted_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

-- Replaces EnrichmentCache.
create table enrichment_cache (
  cache_key text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
```

Notes on the schema vs. the Sheets model:

- **One `leads` table, not one tab per teammate.** `claimed_by` + a
  `WHERE` clause replaces `Claimed - <Name>` tabs entirely — this is the
  single biggest simplification. `getClaimedNpis()` (dedup across
  everyone) becomes `SELECT npi FROM leads`; `listClaimedLeads({
  claimedBy })` becomes `SELECT * FROM leads WHERE claimed_by = $1 AND NOT
  is_disconnected`.
- **`findLeadLocations_`'s whole-column scan disappears.** It becomes
  `SELECT * FROM leads WHERE npi = ANY($1)` with the `idx_leads_npi` index
  doing the work — the exact fix for the 6-minute-timeout bug, but for
  free, as a side effect of using a real database.
- **Row-Level Security (RLS):** if you use Supabase Auth, turn on RLS on
  `leads` and write a policy so a user can only `SELECT`/`UPDATE` their own
  rows (`claimed_by = auth.uid()`) — this makes the "Claimed Leads always
  shows only your own leads" privacy boundary enforced by the database
  itself, not just application code (strictly stronger than what
  `Code.js`'s `leads/list` route does today).

## 2. Decide on auth: Supabase Auth vs. keep it custom — DONE (Google OAuth)

Went a third way not listed below: Supabase Auth, but with **Google OAuth**
as the provider (not email+password), bridged onto the existing `app_users`
table rather than a fresh `profiles` table — see the status section above
and `vercel/lib/auth.js`. The tradeoffs from the "keep custom" option below
mostly don't apply (RLS-via-`auth.uid()` still works, since `app_users.id`
IS `auth.users.id`); the "recommended" email+password option below was not
what got built.

**Recommended: switch to Supabase Auth** (email + password, or magic link).
It gives you real password hashing, session/JWT management, and RLS
integration for free — the entire `AuthService.js` file (222 lines) goes
away. Tradeoff: usernames become email addresses (or you add a separate
`username` lookup table), and you lose the "owner edits a spreadsheet cell
to add/reset an account" workflow — account creation becomes a real signup
flow or an admin-created invite.

**Alternative: keep your own `app_users` table + bcrypt + JWT**, closer to
today's model (a human-readable Username/Password/Display Name table an
admin manages directly, e.g. via Supabase's table editor UI instead of a
spreadsheet). More code to maintain, but keeps the "just add a row" admin
experience. If you go this route:
- Hash passwords with `bcrypt` (never store plaintext, unlike today).
- Issue a signed JWT (e.g. via `jsonwebtoken`) on login, verify it in
  every API route instead of `CacheService.get`.
- You lose Supabase's built-in RLS-via-`auth.uid()` integration — enforce
  the "own leads only" rule in your query's `WHERE` clause instead (still
  fine, just not defense-in-depth at the database layer).

## 3. Set up the Vercel project — DONE

Project `dmedesk-prospector`, Git-connected, production branch
`claude/vercel-supabase-migration-l1fevn`, root directory `vercel`, all env
vars from the table below set. One gotcha hit and fixed along the way: the
Hobby plan caps a deployment at 12 serverless functions — one file per
route (the "Serverless functions" option below, taken literally) used 20.
Fixed by consolidating `api/auth`, `api/leads`, `api/taxonomies` into
`index.js` + `[...action].js` pairs (9 functions total) — see the status
section's note on why `[[...action]]` (optional catch-all) doesn't work
outside Next.js.

1. In the Vercel dashboard, **Import Project** from this GitHub repo.
2. Vercel auto-detects a Node project. Two structural options:
   - **Serverless functions** — create an `api/` directory at the repo
     root; each file (e.g. `api/search/companies.js`) becomes one
     endpoint automatically. Best fit if you're rewriting route-by-route
     anyway.
   - **Express app** — deploy `backend/`'s existing Express app via
     `@vercel/node`, with a `vercel.json` routing all paths to it. Less
     restructuring since `backend/src/app.js` already exists, but you're
     extending a codebase that's been frozen and missing every recent
     feature (see `ARCHITECTURE.md`) — expect to backport the taxonomy/
     claimed-leads/search-resume features from `appscript/services/` into
     it, not just "add a database."
3. Set environment variables in the Vercel dashboard (Project Settings →
   Environment Variables) — same names/values as Apps Script's Script
   Properties had, plus the new Supabase ones:

   | Variable | Where it comes from |
   |---|---|
   | `SUPABASE_URL` | Supabase project settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings → API (server-side only — never expose to the browser) |
   | `SUPABASE_ANON_KEY` | Supabase project settings → API (safe for the browser, if the frontend talks to Supabase directly for anything) |
   | `NPPES_VERSION` | optional, defaults `2.1` |
   | `FOURSQUARE_SERVICE_API_KEY` | optional |
   | `GEMINI_API_KEY` / `GEMINI_MODEL` | optional |
   | `JWT_SECRET` | only if you kept custom auth (section 2) |

4. Push to your default branch — Vercel auto-deploys on every push, with
   PR preview deployments for free (a nice upgrade over Apps Script's
   manual "new deployment version" step).

## 4. Port each service

| Today (`appscript/services/`) | Becomes | Notes |
|---|---|---|
| `NppesService.js` | Node module, near-identical | Swap `UrlFetchApp.fetch` for `fetch`/`axios`; `backend/src/services/nppes.service.js` already has this |
| `FoursquareService.js`, `OsmService.js`, `CmsService.js` | Node modules, near-identical | Same swap; `backend/src/services/*` already has these |
| `ScraperService.js` | **Upgrade, don't port as-is** | Node has real `cheerio` — go back to `backend/src/services/scraper.service.js`'s proper DOM-based version instead of Apps Script's regex-heuristic degradation |
| `ScoringService.js`, `RoleClassifier.js` | Pure functions, copy verbatim | No I/O, no changes needed |
| `AiBriefService.js` | Node module, near-identical | Swap `UrlFetchApp` for a real Gemini SDK/fetch call |
| `CsvExport.js` | Copy verbatim | Pure string building |
| `AuthService.js` | **Replace**, don't port | See section 2 — becomes Supabase Auth calls or a bcrypt+JWT module against `app_users` |
| `SheetsStore.js` | **Replace with SQL queries** | Every function becomes a Supabase/`pg` query against `leads`/`lead_notes`/`suggestions`. `findLeadLocationsForNpis_`'s batch-scan optimization (added 2026-07-21) becomes irrelevant — a single indexed query replaces it entirely |
| `TaxonomyService.js` | **Replace with SQL queries** | `listEnabled`/`search`/`enable` against the `taxonomies` table (full-text search via Postgres `ILIKE` or a `tsvector` column instead of a Sheets column scan) |
| `SearchProgressService.js` | **Replace with SQL queries** | `getProgress`/`saveProgress` become `SELECT`/`UPSERT` against `search_progress` keyed on `(user_id, filter_fingerprint)` — the fingerprint logic itself (`fingerprint()`) is pure and copies over unchanged |
| `EnrichmentCache.js` | **Replace with SQL queries** | `enrichment_cache` table, or just use Vercel KV / Supabase's `pg` cache — either way, a plain key→JSON lookup |
| `CompanyService.js` | Mostly copy verbatim | The NPPES pagination/branch-merge/round-robin logic is pure orchestration — only the calls into `SheetsStore`/`SearchProgressService` need to change to the new query-based versions |
| `Code.js` | **Replace with real routes** | Becomes your `api/` directory's actual endpoints (or Express routes) — no more `?path=` dispatch, use real paths/methods (`GET /api/leads`, `POST /api/leads/:npi/status`, etc.) |

## 5. Update the frontend request layer

`docs/app.js`'s `apiGet`/`apiPost` (see `ARCHITECTURE.md`'s CORS section)
exist entirely to work around Apps Script's limitations. Once real CORS
and real HTTP semantics are available, simplify:

```js
// Before (Apps Script workaround):
async function apiPost(path, body) {
  const query = new URLSearchParams({ path, token: getSession()?.token || "" });
  const res = await fetch(`${APPS_SCRIPT_URL}?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  return unwrap(await res.json());
}

// After (real API, real CORS):
async function apiPost(path, body) {
  const res = await fetch(`${API_BASE_URL}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getSession()?.token || ""}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  return (await res.json()).data;
}
```

Also update every route path used throughout `app.js` (`leads/list`,
`leads/status`, `search/companies`, etc.) to match whatever real route
shape you choose on the new API (they can stay identical strings if you
keep the same `path` segments as route names — least churn).

## 6. Migrate existing data — decided, not yet done

**Decision: one-time CSV export/import, not a live Apps Script mirror
script.** A mirror only earns its complexity if both stores need to stay
live and in sync; this migration is a single cutover, so a mirror would add
conflict-resolution and double-write risk for no real benefit — export
once, right before cutover, per step 4 below.

Before cutting over, get whatever's already in the production Google Sheet
into Supabase:

1. Export each `Claimed - *` tab, `Disconnected`, `Taxonomies`, and `Users`
   to CSV (File → Download → CSV in Google Sheets, once per tab).
2. Use Supabase's table editor **Import data from CSV**, or write a small
   one-off Node script using `@supabase/supabase-js` to read each CSV and
   insert rows — the latter is easier to get column mapping/type
   conversion (dates, numbers) right in one pass.
3. For `Users` specifically: since auth is Google OAuth (not
   email+password — see section 2), there's no password to migrate at all.
   Each teammate signs in with Google once, which auto-creates their
   `app_users` row with a NEW id (`auth.users.id`, not whatever numeric/UUID
   id the old Users tab had). The CSV import script needs a manual
   `old username → new app_users.id` mapping (built by having everyone sign
   in first, then reading their new ids back out of `app_users.username`,
   which is seeded from their Google email) to set `claimed_by` /
   `status_updated_by` / `created_by` / `submitted_by` correctly on import —
   there's no way to automate that mapping without it.
4. Spot-check row counts per teammate against the original tabs before
   decommissioning anything.

## 7. Cutover

1. Deploy the new Vercel API, fully tested against the Supabase project,
   *before* touching the frontend config.
2. Update `docs/config.js` (or wherever `API_BASE_URL` now lives) to point
   at the Vercel URL, deploy the frontend (GitHub Pages or Vercel).
3. Have every teammate sign in fresh (new auth system = new sessions
   regardless of which auth option you chose).
4. Run the app in parallel with the old Apps Script deployment for a few
   days if you want a safety net — nothing about running both
   simultaneously conflicts, since they'd be reading from different data
   stores by this point (which is also why data migration in step 6 must
   happen *once*, right before cutover, not on some earlier date — every
   claim/status change made in the Apps Script version after your export
   won't be in Supabase).
5. Once confirmed working, delete the Apps Script deployment (**Deploy →
   Manage deployments** → remove) and stop billing/using the Google Sheet
   for anything but historical reference.
