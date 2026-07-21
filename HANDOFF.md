# Handoff: Vercel + Supabase migration setup

Status as of this branch's last commit. If you're a fresh Claude session
picking this up, read this file first, then `vercel/README.md` and
`/MIGRATION_TO_VERCEL_SUPABASE.md` at the repo root.

## Where things stand

- Branch: **`migrate/vercel-supabase`** (pushed to origin, deliberately
  **not merged** into `main` -- `appscript/` + `docs/` remains the live
  production system).
- All code is written and syntax-checked: `supabase/migrations/0001_init.sql`
  (full Postgres schema) + `vercel/` (a complete Node/Vercel API, ported
  from `appscript/services/`). See `vercel/README.md` for exactly what's
  implemented vs. deferred (the frontend hasn't been rewired yet; no real
  Supabase project has had the migration applied yet).
- **The user has connected Supabase and Vercel MCP connectors** and asked
  me to actually run the setup (apply the migration, deploy). This was
  interrupted partway through by an MCP connection issue -- see below.

## Decisions already confirmed by the user -- do not re-ask these

- **Supabase project to use: `dmedesk-prospector`** (project ref
  `pcvyrkisvvtiteoiuplg`, region eu-west-1, created 2026-07-21). There is
  ALSO an older, unrelated `home services prospector` Supabase project
  (eu-central-1, created 2026-07-16) -- the user explicitly chose
  `dmedesk-prospector`, not that one. Don't touch the other project.
- **Vercel: create a brand-new project** for this app. There is no
  existing Vercel project matching this repo's name -- only
  `home-services-prospector` (id `prj_l7dfTXcUTTAEd8d5XGCFnoaWPzEO`)
  exists, which is a different, unrelated project. The user explicitly
  chose to create a new one rather than reuse that. Vercel team: `malak`
  (slug `malaak00`, id `team_JjRlabPW2SsbF7dPdjsq9mV5`).

## What was blocking progress

`ListConnectors` showed both Supabase and Vercel as `connected: true` at
the account level but `enabledInChat: false` for this specific chat --
meaning their MCP tools (`mcp__Supabase__*`, `mcp__Vercel__*`) were never
actually loaded into this session's tool list (confirmed via `ToolSearch`
returning nothing for them), even after the user said they'd toggled them
on. This looked like a client-side sync issue rather than something
fixable from inside the session, so the user is starting a fresh
conversation to see if that resolves it. **First thing to do in a new
session: call `ListConnectors` with keywords `["supabase", "vercel"]` and
confirm `enabledInChat: true` for both before doing anything else.** If
still `false`, tell the user the toggle isn't taking effect and they may
need to check the actual connector settings UI rather than retry blind.

## Exact next steps once the Supabase/Vercel tools are actually available

1. **Sanity-check the target Supabase project** -- `list_tables` on
   project `pcvyrkisvvtiteoiuplg` to confirm it's empty/fresh (no
   surprise existing tables) before applying anything.
2. **Apply the migration** -- `apply_migration` (or equivalent) with the
   full contents of `supabase/migrations/0001_init.sql` against project
   `pcvyrkisvvtiteoiuplg`.
3. **Get connection details** -- `get_project_url` and
   `get_publishable_keys` (the anon/publishable key) for that same
   project. The Supabase MCP tools deliberately do NOT expose the
   `service_role` key (security boundary on their end) -- that one has to
   come from the user directly: ask them to copy it from the Supabase
   dashboard (Settings -> API -> `service_role` key, "reveal" then copy)
   and paste it to you.
4. **Create the Vercel project** -- deploy the `vercel/` subdirectory (NOT
   the repo root -- set the project's root directory to `vercel`) as a new
   project under team `team_JjRlabPW2SsbF7dPdjsq9mV5`. Suggested project
   name: `dmedesk-prospector` (fall back to `dmedesk-prospector-api` or
   similar if that name's taken).
5. **Set Vercel environment variables** (see `vercel/.env.example` for the
   full list and what each one is for):
   - `SUPABASE_URL` -- from step 3
   - `SUPABASE_ANON_KEY` -- the publishable key from step 3
   - `SUPABASE_SERVICE_ROLE_KEY` -- from the user directly (step 3's caveat)
   - `ALLOWED_ORIGINS` -- ask the user what origin(s) will call this API
     (their GitHub Pages URL if keeping `docs/` there during a parallel-run
     cutover, and/or a future final domain); do NOT default this to `*`
   - `NPPES_VERSION` -- `2.1` is fine as a default
   - `FOURSQUARE_SERVICE_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL` --
     optional, ask the user if they want these carried over from the Apps
     Script deployment's Script Properties (same key values work here)
6. **Create at least one test Supabase Auth user** (dashboard ->
   Authentication -> Add user, email + password) so login can actually be
   tested end to end.
7. **Deploy and smoke-test**: hit `/api/health` (should be public, no
   auth), then `/api/auth/login` with the test user's email/password, then
   use the returned token as `Authorization: Bearer <token>` against
   `/api/leads` and `/api/search/companies?city=...` (or similar) to
   confirm the whole stack -- Vercel function -> Supabase Postgres/Auth,
   RLS included -- actually works together.
8. Report back what was created (Supabase project confirmed, migration
   applied, Vercel project URL, which env vars are set vs. still need the
   user's manual input) and what if anything failed.

## Everything else you need is already in the repo

- `ARCHITECTURE.md` -- how the current (Apps Script) production system works.
- `MIGRATION_TO_VERCEL_SUPABASE.md` -- the full migration plan this branch implements.
- `vercel/README.md` -- what's built on this branch, what's deferred, local dev instructions.
- Full prior session history/reasoning for all of the above lives in this
  same repo's git log on `migrate/vercel-supabase` and `main` if more
  detail is ever needed -- commit messages are written to be
  self-explanatory.
