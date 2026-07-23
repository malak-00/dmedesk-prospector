# Implementation plan: full frontend rewire + cutover to Vercel + Supabase

This is the detailed plan for the two things `MIGRATION_TO_VERCEL_SUPABASE.md`
sections 5 and 7 describe at a high level. Read `HANDOFF.md` and that doc's
"Current status" section first — this plan assumes sections 1-3 are already
done (they are, as of this writing).

Read `SHEETS_MIRROR_PLAN.md` alongside this one before starting step 2 below
— it covers the data-migration piece this plan defers to it.

## Why this is one plan, not two

The frontend rewire (section 5) and the cutover (section 7) aren't separable
in practice: you can't cut over without the rewire done, and there's no
reason to finish the rewire and then sit on it — the moment it's done and
tested, cutover is just flipping which URL people use. This plan sequences
both as one path.

## Current starting point (don't re-derive this)

- `docs/app.js` still targets Apps Script (`APPS_SCRIPT_URL`) for every
  feature except a gated "Sign in with Google (new API test)" button, which
  talks to the real Vercel API. Both `docs/` (GitHub Pages, cross-origin) and
  `vercel/` (same-origin copy, served directly by the Vercel project) have
  their own copy of `app.js`/`config.js` now — see `HANDOFF.md`.
- The Vercel API (`vercel/api/**`) already implements every route
  `docs/app.js` needs except `suggestions/submit`, `debug/foursquare`,
  `debug/suggestion-email` (deferred per `vercel/README.md` — small, add
  them the same way as everything else if needed before cutover).
- Auth is Google OAuth only. There is no username/password login against
  the new backend, and there won't be — `docs/app.js`'s login form needs to
  be replaced, not adapted.

## Step 1: Decide where the frontend permanently lives

Two real options (same choice `MIGRATION_TO_VERCEL_SUPABASE.md` already
posed, now with `vercel/`'s copy already in place to inform the decision):

| | Keep `docs/` on GitHub Pages | Keep the `vercel/` copy, drop `docs/` |
|---|---|---|
| CORS | Needed (`ALLOWED_ORIGINS` must include the Pages origin) | None — same-origin |
| Domains to remember | Two (Pages + Vercel API) | One |
| Deploy step | Two separate deploys per change | One |
| Google OAuth redirect URLs | Must allow-list the Pages origin in Supabase | Must allow-list the Vercel origin (already needed either way) |

**Recommendation: drop `docs/`, keep the `vercel/` copy as the one real
frontend.** It's simpler (one deploy, no CORS) and it already exists.
Concretely:
- Delete `docs/` (or leave it as a dead GitHub Pages site pointing nowhere,
  your call — deleting is cleaner).
- `vercel/index.html`/`app.js`/`config.js`/etc. become canonical.
- Retire `VERCEL_API_URL`/`VERCEL_API_ENABLED` as separate flags once this
  is the only copy — the app just always talks to same-origin `/api/*`.

If you'd rather keep `docs/` on GitHub Pages instead, swap "vercel/" and
"docs/" everywhere below — the steps are otherwise identical.

## Step 2: Rewrite the request layer

In `app.js` (whichever copy survives step 1):

1. Replace `apiGet`/`apiPost` (currently building `?path=&token=` query
   strings against `APPS_SCRIPT_URL`) with real REST calls:

   ```js
   async function apiGet(path, params = {}) {
     const query = new URLSearchParams(params);
     const res = await fetch(`${API_BASE}/api/${path}?${query}`, {
       headers: { Authorization: `Bearer ${getSession()?.token || ""}` },
     });
     return unwrap(await res.json());
   }

   async function apiPost(path, body) {
     const res = await fetch(`${API_BASE}/api/${path}`, {
       method: "POST",
       headers: {
         "Content-Type": "application/json",
         Authorization: `Bearer ${getSession()?.token || ""}`,
       },
       body: JSON.stringify(body),
     });
     return unwrap(await res.json());
   }

   function unwrap(payload) {
     if (!payload.success) {
       const err = new Error(payload.error || "Request failed");
       throw err;
     }
     return payload.data;
   }
   ```

   `API_BASE` is `""` if same-origin (step 1's recommendation), or the full
   Vercel URL if cross-origin.

2. **Route path mapping** — the old `path` strings map onto the new API's
   real paths + methods. Build this table once and update every call site:

   | Old (`apiGet`/`apiPost` path) | New method + path |
   |---|---|
   | `auth/login` | *(removed — see step 3)* |
   | `auth/logout` | `POST /api/auth/logout` |
   | `auth/exclude-keywords` | `POST /api/auth/exclude-keywords` |
   | `leads/list` | `GET /api/leads` |
   | `leads/claim` (export/sheets in old naming) | `POST /api/leads/claim` |
   | `leads/status` | `POST /api/leads/status` |
   | `leads/notes` | `POST /api/leads/notes` |
   | `leads/notes/replace` | `POST /api/leads/notes/replace` |
   | `leads/reminder` | `POST /api/leads/reminder` |
   | `leads/disconnect` | `POST /api/leads/disconnect` |
   | `leads/return-to-prospect` | `POST /api/leads/return-to-prospect` |
   | `export/disconnected` | `POST /api/leads/disconnect-new` |
   | `search/companies` | `GET /api/search/companies` (query params, not POST body — see `vercel/api/search/companies.js`) |
   | `taxonomies/list` | `GET /api/taxonomies` |
   | `taxonomies/search` | `GET /api/taxonomies/search?q=...` |
   | `taxonomies/enable` | `POST /api/taxonomies/enable` |
   | `export/csv` | `POST /api/export/csv` |
   | *(new)* | `POST /api/brief/generate` (AI call brief — wasn't in the old app at all, or was it a different route? verify against current `docs/app.js` before assuming) |

   Grep `docs/app.js` for every `apiGet(`/`apiPost(` call site before
   starting — the table above is built from `vercel/api/**`'s existing
   routes, not from re-reading the old Apps Script `Code.js` dispatch table,
   so double check nothing's missing.

3. **`search/companies` becomes a GET with query params, not a POST body.**
   This is the biggest shape change — every filter (`state`, `states`,
   `nameContainsTerms`, `excludeKeywords`, `variantSkips`, etc.) becomes a
   query param, with arrays as comma-joined strings and `variantSkips` as a
   JSON-stringified param (see `vercel/api/search/companies.js`'s
   `parseCommaList`/`parseVariantSkips` for the exact expected shapes).

## Step 3: Replace the login flow entirely

The password `<form id="loginForm">` goes away — there is no
username/password auth against the new backend. Replace with:

1. Remove the username/password fields from `index.html`'s login card;
   keep only a "Sign in with Google" button (the one already there, just
   un-gate it — no more `VERCEL_API_ENABLED` conditional once this is the
   only auth path).
2. `handleGoogleSignIn`/`handleGoogleOAuthCallback` (already written, see
   `vercel/app.js`) become the ONLY sign-in path — no changes needed there,
   just delete the now-dead `handleLogin` function and its form listener.
3. `saveSession`/`getSession`/`clearSession` (sessionStorage-based) stay
   as-is — `exchangeSession`'s response shape (`{ token, email, displayName,
   excludeKeywords }`) already matches what the rest of `app.js` expects
   from a login response.
4. Every other feature that read `session.username` needs to read
   `session.email` instead (Google OAuth is email-based, not
   username-based) — grep for `.username` in `app.js` and check each site.

## Step 4: Add the deferred routes (if you need them before cutover)

`suggestions/submit`, `debug/foursquare`, `debug/suggestion-email` aren't
implemented on the new API yet (see `vercel/README.md`'s "What's deferred").
If `app.js` calls any of these, port them the same way every other route
was ported (one file under `vercel/api/`, or add a branch to the relevant
catch-all — see `vercel/api/leads/[...action].js` for the pattern) before
cutover, or accept those features being broken during the parallel-run
period.

## Step 5: Data migration

See `SHEETS_MIRROR_PLAN.md` — this has to run and be verified BEFORE the
frontend rewire goes live for real users, not after. Don't start step 6
until that's done.

## Step 6: Test end-to-end against the new backend

With the rewired `app.js` deployed to a preview URL (Vercel gives you one
automatically on every push to this branch — don't test on production
until this step passes):

1. Sign in with Google, confirm the `app_users` row appears with the right
   display name.
2. Run a search, confirm NPPES + enrichment still work (these routes are
   unchanged from the old backend, just moved — should just work).
3. Claim a lead, add a note, set a reminder, change status, disconnect it,
   return it to Prospect — the full claimed-leads lifecycle.
4. Confirm RLS actually blocks cross-user access: sign in as a second
   Google account, confirm you cannot see the first account's claimed leads
   via `GET /api/leads` (this should already be true by construction, but
   verify it once for real before trusting it in production).
5. Export CSV, confirm the file matches the old format teammates expect.

## Step 7: Cutover

1. Merge this branch (or just the rewired frontend + already-deployed API)
   — decide whether to merge to `main` now or keep running from this branch
   a while longer. Merging to `main` doesn't itself change what's live
   anywhere; it's just where the code lives.
2. Point whatever DNS/bookmark/link teammates use at the new frontend URL.
3. Announce the cutover — every teammate needs to sign in fresh with Google
   (new auth system entirely, no session carries over).
4. Run in parallel with the Apps Script deployment for a few days if you
   want a safety net (see `MIGRATION_TO_VERCEL_SUPABASE.md` section 7's
   reasoning on why this is safe: different data stores, no double-write
   risk, AS LONG AS `SHEETS_MIRROR_PLAN.md`'s mirror script direction is
   Sheets → Supabase only, never the reverse).
5. Once confirmed stable, turn off the Apps Script mirror script (see that
   plan's own step on this), delete the Apps Script deployment, stop using
   the Google Sheet for anything but historical reference.

## Open questions to resolve before starting (ask the user, don't guess)

- Keep `docs/` or drop it (step 1) — has a real UX/ops tradeoff, not purely
  technical.
- Exact route path mapping in step 2 needs a fresh grep of the CURRENT
  `docs/app.js` (it may have changed since this plan was written) —
  don't trust the table above blindly, verify it.
- Whether to merge to `main` as part of cutover or keep this a long-lived
  branch — affects how the team's git workflow looks afterward.

### CORS configuration update (2026-07-23)

Set ALLOWED_ORIGINS to the canonical production origins. Cloudflare Pages preview subdomains are accepted by the API CORS matcher. Do not use a leading //, trailing slash, or a fallback origin in the response header.

