# Handoff: Vercel + Supabase migration setup

Status as of this branch's last commit. If you're a fresh Claude session
picking this up, read this file first, then `vercel/README.md` and
`/MIGRATION_TO_VERCEL_SUPABASE.md` at the repo root (its "Current status"
section at the top is the authoritative summary — this file is a shorter
version of the same thing plus session-specific gotchas).

## Where things stand

- Branch: **`claude/vercel-supabase-migration-l1fevn`**, tracked by
  [PR #6](https://github.com/malak-00/dmedesk-prospector/pull/6) — **don't
  open a new PR**, push commits to this branch and the existing PR updates.
  Deliberately not merged into `main` -- `appscript/` + `docs/` remains the
  live production system until an explicit cutover.
- **Supabase**: project `dmedesk-prospector` (ref `pcvyrkisvvtiteoiuplg`,
  `https://pcvyrkisvvtiteoiuplg.supabase.co`). Schema applied
  (`supabase/migrations/0001_init.sql` + `0002_enable_rls_and_google_oauth_bridge.sql`),
  RLS enabled on every table, `app_users.id` bridged to `auth.users.id`,
  Google OAuth configured as the provider (both in Google Cloud Console and
  Supabase's Authentication → Providers → Google).
- **Vercel**: project `dmedesk-prospector` (`prj_hGV86e3Not6U8fjhR9hZMJa73mVv`,
  team `malak`), Git-connected to this repo, production branch
  `claude/vercel-supabase-migration-l1fevn`, root directory `vercel`. Live
  at `https://dmedesk-prospector.vercel.app`. All env vars set.
- **Verified working**: `/api/health` (200), `/api/auth/google` (200, real
  Supabase Google-OAuth URL), `/api/leads` + `/api/taxonomies` (401 "Not
  signed in" when unauthenticated -- i.e. reaching the real handler).

## Two real bugs hit and fixed this session -- know about these before debugging anything that looks similar

1. **Vercel's Git integration was pointed at `main` initially**, which has
   none of the `vercel/` code (deliberately unmerged) -- if a deploy ever
   looks like it's serving nothing / 404s everywhere, check Project
   Settings → Git → Production Branch and → General → Root Directory
   first, before assuming the code is broken.
2. **`[[...action]].js` (optional catch-all) doesn't work outside
   Next.js.** Vercel's plain Functions only support the required catch-all
   `[...action].js`, which never matches a bare path with zero segments.
   `api/leads` and `api/taxonomies` are now split into `index.js` (the bare
   GET route) + `[...action].js` (everything else). Separately,
   `req.query`'s file-system dynamic-segment population isn't reliable for
   plain Functions either -- `vercel/lib/http.js`'s
   `getActionSegments(req, basePath)` parses the action from `req.url`
   directly instead. If you add a new catch-all route, follow this pattern,
   not the naive `req.query.action` one.

## Decisions already confirmed by the user -- do not re-ask these

- Supabase project: `dmedesk-prospector` (not the older, unrelated `home
  services prospector` project).
- Vercel: new project `dmedesk-prospector` under team `malak` (not the
  older, unrelated `home-services-prospector` project).
- **Keep the existing `app_users`-based schema as-is** (not the
  `profiles`/`auth.users`-only design an earlier draft of
  `supabase/migrations/0001_init.sql` had sketched) -- bridge it to
  Supabase Auth via a foreign key instead of replacing it.
- **Auth provider: Google OAuth**, not email+password.
- **Data migration: one-time CSV export/import**, not a live Apps Script
  mirror script (see `MIGRATION_TO_VERCEL_SUPABASE.md` section 6).

## What's NOT done yet

1. **Data migration** (`MIGRATION_TO_VERCEL_SUPABASE.md` section 6) --
   nothing's been exported from the live Google Sheet yet. Needs the
   `old username → new app_users.id` mapping described there before
   writing an import script, since Google OAuth means there's no password
   to carry over and every teammate gets a brand-new id on first sign-in.
2. **Frontend rewire** (`MIGRATION_TO_VERCEL_SUPABASE.md` section 5) --
   `docs/app.js` still targets the Apps Script `?path=&token=` API for
   everything except a gated "Sign in with Google (new API test)" button
   (see `docs/config.js`'s `VERCEL_API_URL`, currently blank/inert). Full
   rewire to the real REST API + `Authorization: Bearer` headers hasn't
   been done.
3. **Cutover itself** (`MIGRATION_TO_VERCEL_SUPABASE.md` section 7) --
   blocked on both of the above.

## Login is Google-only now, and there's a third frontend deployment option

The password login form is gone entirely from `docs/index.html` and
`vercel/index.html` -- "Sign in with Google" is the only way in, for both
copies. `handleGoogleOAuthCallback` now actually saves the session and
loads the app (it used to just show a toast and stop, back when it was a
"test the new backend" button rather than the real login).

A third frontend option now exists alongside `docs/` (GitHub Pages) and
`vercel/`'s own copy: **Cloudflare Pages**, built from `cloudflare/`.
`cloudflare/build.js` assembles `cloudflare/dist/` from `vercel/`'s shared
source files, swapping in `cloudflare/config.js` (which needs the full
`https://dmedesk-prospector.vercel.app` URL, since Pages is cross-origin to
the API, unlike `vercel/`'s own same-origin copy). Deploy with
`cd cloudflare && npm run deploy` (needs `wrangler` configured separately).
This makes THREE places running frontend code that all need to stay in
sync by hand until the full rewire (`CUTOVER_PLAN.md`) picks one and drops
the rest -- see that plan's step 1.

## CORS

`vercel/lib/http.js`'s `isAllowedOrigin` accepts: exact matches from the
`ALLOWED_ORIGINS` env var, `localhost`/`127.0.0.1` (any port, for local
dev), and any `https://<anything>.dmedesk-prospector.pages.dev` (Cloudflare
Pages preview deployments get a random subdomain per build, so an exact
allow-list entry isn't possible for those). Set `ALLOWED_ORIGINS` on Vercel
to include every production origin that's actually live, e.g.
`https://dmedesk-prospector.vercel.app,https://dmedesk-prospector.pages.dev`
if the Cloudflare Pages option is deployed too -- there's no tooling to
read/set this from a session, so check it directly in the Vercel dashboard
if a frontend copy is getting CORS errors calling the API.

## A note on the SUPABASE_ANON_KEY env var

A collaborator's branch had a hardcoded patch in `lib/config.js` that
silently rewrote `SUPABASE_ANON_KEY` if the configured value contained a
substring matching a DIFFERENT Supabase project ref than
`pcvyrkisvvtiteoiuplg`. That patch was deliberately NOT merged (patching
around a bad env var in source code hides the real problem instead of
fixing it) -- if API calls ever fail with an auth/project-mismatch-shaped
error, check the actual `SUPABASE_ANON_KEY` value in the Vercel dashboard
directly rather than assuming the code is wrong.

## Multiple people pushing directly to this Vercel project

At least two other collaborators (branches `newlogin`, `bensss`) have been
pushing straight to this repo and, at times, to this same Vercel project's
production target -- production flipped between branches more than once.
`newlogin`'s real improvements (the Google-only login rewrite, the CORS
fix, the Cloudflare Pages option) have been merged into this branch as of
this note. If you're a fresh session picking this up: check `git log
--all --oneline` for anything that's landed on other branches since, before
assuming this branch is the only place work is happening.

## Everything else you need is already in the repo

- `ARCHITECTURE.md` -- how the current (Apps Script) production system works.
- `MIGRATION_TO_VERCEL_SUPABASE.md` -- the full migration plan, now updated
  in place to mark sections 1-3 done and describe what was actually built
  (its "Current status" section at the top is the fastest way to get
  oriented).
- `vercel/README.md` -- what's built, local dev instructions, updated auth
  flow (Google OAuth, not password login).
- Full prior session history/reasoning lives in this branch's git log if
  more detail is ever needed -- commit messages are written to be
  self-explanatory.
