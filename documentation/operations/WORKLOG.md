# DME Desk Prospector Worklog

## 2026-10-08 — Sheet import: statement timeouts on "Check what would happen" (frontend only)

**Objective.** The check/import failed with "Failed to check lead ownership: canceling statement due to statement timeout" when the database was slow on a batch of 5.

**Actions Completed.** `docs/controls.js` `claimChunk()`: on a timeout the batch is split in half and each half retried, down to one lead at a time; a single lead that still times out is reported as an error row ("nothing was changed, run again"). A timed-out `claim_leads` call is one rolled-back transaction, so a retry cannot double-claim. Duplicates need no change: a repeated NPI in the file is imported once (counted as "repeated"), and a lead the rep already holds comes back "Already theirs" and is skipped (the unique index on active (npi, claimed_by) would refuse it anyway).

**Database / System Result.** None. No SQL, no worker change.

**Safety Status.** If the timeouts persist on single leads, the cause is the identity-match scan inside `claim_leads`' dry run (it reads every other rep's active lead per call); that would need a reviewed SQL change, not done here.

## 2026-10-08 — Sheet conflicts panel in Admin → Controls (code only, not deployed)

**Objective.** When a sheet is uploaded, claim the leads the app doesn't have for the sheet's opener (already done by the existing import) and show the ones the app already gives to someone else, with the app owner and the sheet owner side by side, and let an admin decide.

**Actions Completed.**
- `worker/src/repos/adminRepo.js` + `POST /admin/sheet-conflicts/lookup` (admin only, read-only): current owner, status and business group for up to 200 NPIs.
- `claim_leads` blocked results now also carry `groupId` and `ownerIds` (`fromClaimResult`); additive.
- `docs/sheetlib.js`: `sheetConflicts()` pairs each blocked row with the sheet's rep and the app owner; `verdictFor` keeps the group id on blocked rows.
- `docs/controls.js`: after "Check what would happen" or "Import", a **Sheet conflicts** table (row, company, sheet says, app says) with **Give to <sheet rep>** and **Keep <app owner>**. Give calls the existing audited `POST /admin/conflicts/resolve` (reason required, recorded as a `reassigned` event, approver from the session); Keep only dismisses the row in the page. Rows whose opener is blank or matches no user are looked up too and get a rep dropdown on the row: if the app already owns the lead the action is Give to (same audited resolve), if the app has no owner it is **Claim for** (the normal `claim-for-user`), and Skip leaves it.
- Tests: `worker/test/sheetConflicts.test.js`, additions to `worker/test/sheetlib.test.js`; suite 184/184.

**Database / System Result.** No schema change, no SQL run, no production write. The panel is rebuilt on each upload (nothing is stored), so re-uploading the sheet shows what is still open.

**Safety Status.** Nothing is moved without an admin clicking Give and confirming, and a reason. Moving a lead moves its whole business group (existing resolve behaviour). Needs the Worker deployed first; until then the panel says it could not load owners and the rows stay in the normal blocked list.

## 2026-10-08 — BD MEETINGS bot sync diagnosis; two Onboarded leads claimed by hand

**Objective.** Find why the BD MEETINGS "Onboarded" sync landed some leads and not others, and fix what was left over.

**Actions Completed.**
- Diagnosed the deployed Apps Script `syncNpiToProspector()`: it reads Opener/Company/Phone from hardcoded columns 2/5/7, but the tabs have MEDB/PPO/SUB checkbox columns A–C (Opener is D, Company G, Phone I). On Onboarded every row's opener read as a checkbox, so every row was skipped. Wrote the header-driven replacement `documentation/operations/bd-meetings-sync-fixed.gs` (not deployed from this repo; Ben owns the clasp project).
- Read-only checks of production `leads`, `npi_records`, `lead_ownership_events`: no company-name-in-phone leads exist; two odd phones (Clayton two numbers, Bestchoice malformed).
- Dry-run `claim_leads` for Home Care Medical Supplies (1235990193, Ben) and Allied Medical Health (1841989019, Jimmy): both clear.
- Real claim of those two via `claim_leads(..., p_actor_id => bd-meetings-bot)`, status `onboarded`, sheet phone/email/notes and opener summary attached, registry address/specialty/official filled in.

**Database / System Result.** Two `leads` rows inserted (ids 370650c0-…, 58ba9af8-…) with two `claimed` events (`source = claim_for_user`). No other rows touched; no schema change.

- Reopened the three disconnected sheet leads and gave them to Ben (the sheet opener; Prime Ortho has no opener so it takes the default user): DME Direct Inc (was Rickk, disconnected), ADL Ortho (was Nora, status "disconnected"), Prime Ortho Fitting (was Nora, disconnected). Each got `is_disconnected = false`, `status = 'onboarded'`, `claimed_by = Ben`, and a `reassigned` event (source `admin_conflict_resolution`, approver Caroline Richards, previous status/owner in the event). `claimed_at`, notes and everything else were left alone.

- Code (not deployed, not run against production): new `POST /admin/sync-lead-status` (`syncLeadStatusesFromSheet` in `worker/src/repos/leadsRepo.js`). The sheet wins on status for leads the named teammate already holds; Last Call moves `status_updated_at` forward only; never changes ownership, never reopens a disconnected lead, no team win announcements. Permission check pulled into a shared `requireClaimForOthers` used by both endpoints. Tests in `worker/test/sheetStatusSync.test.js`; whole worker suite 179/179 passing. `bd-meetings-sync-fixed.gs` now sends status + Last Call, re-sends a row only when it changes, uses a script lock, and has a 2-hour trigger helper.

**Safety Status.** The claim went through the audited function; the three reassignments were one statement writing the event and the update together. No DROP/DELETE/TRUNCATE. Not changed (needs a decision): sheet-vs-app owner differences on Delta Medical, Caring Med, Direct DME (Colby), Mo Med, Platinumcare. The Ownership conflicts panel only lists a group with active leads owned by 2+ people, so these single-owner leads cannot appear there without creating a second active claim on the same NPI, and Resolve would skip that duplicate row (`resolve_ownership_conflict` skips a row when the target already holds the NPI).

## 2026-10-08 — Merge all eligible: timeouts after ~9,000 merges, and visible progress (sql/036, written, not run)

### Objective
After the first run merged about 9,000 pairs and was stopped, running it again kept timing out, and the button gave no sign it was working between updates.

### Actions Completed
- Cause (inferred, not confirmed on the database): batches were read from `registry_review_queue`, whose per-row `identity_pair_decided()` expands both pairs' whole groups; merged groups had grown, and every rerun rescanned from the top.
- `sql/036_registry_merge_batch.sql`: `registry_merge_next_batch()` selects the next pairs from `registry_match_candidates` in key order with cheap tests; `merge_identity_pair_if_safe()` now applies the group-level "already decided" check per pair (25 per batch instead of per scanned row).
- Worker reads batches through the new function (503 with a "run sql/036" message until it exists). 167 tests pass.
- Admin tab: a progress strip appears the moment "Merge all eligible…" is clicked (spinner, sliding bar while counting, filled bar, merged/held-back counts, a clock that ticks every second); style.css v=75, app.js v=64.

### Database / System Result
None yet: sql/036 has not been run. The 9,000 merges from the first run are in place.

### Safety Status
Same merge rules as 035 (Tier 2 plus official+phone; refuses groups owned by different agents). Merges cannot be undone from the app.

## 2026-10-08 — Merge all eligible registry matches (sql/035, written, not run)

### Objective
Let an admin merge the eligible registry-wide matches in bulk instead of ticking up to 500 at a time.
Decisions (user): merge Tier 2 matches plus official+phone; preview, confirm, then keep running to the end.

### Actions Completed
- `sql/035_registry_merge_all.sql`: `registry_merge_preview(keys)` (read-only counts) and
  `merge_identity_pair_if_safe(...)`, which merges one pair through `resolve_identity_match` only if at most
  one agent owns anything in either group, checked in the same transaction under a lock.
- Worker: `GET /admin/match-reviews/merge-all-preview` and `POST /admin/match-reviews/merge-all` (batches of
  25 by keyset cursor). Admin tab: "Merge all eligible…" (All providers view only; becomes Stop while running).
- Also earlier today: the All providers list loads 500 pairs, then "Load 100 more" (replaced an endless
  auto-load); sql/033_release_keeps_claimed_at.sql fixes Return to Prospect.
- 167 worker tests pass (4 new). No browser testing.

### Database / System Result
None yet: sql/035 has not been run. Name+phone and name+official matches alone are never auto-merged.

### Safety Status
Merges write the normal decision rows and group evidence but cannot be undone from the app. Ownership never
changes; pairs touching groups owned by different agents are held back for manual review.

## 2026-10-07 — Registry-wide identity matching over npi_records (migration drafted, not applied)

### Objective
Five NPIs run by the same official (Furqan Saadat) were not flagged for merging. Read-only check showed
three are only in `npi_records` (no lead, no group, so the lead-only review view never sees them), and
United Medical Supply (1598576696) has a different location phone, so the location-first phone key never
matched it to the rest. Decisions: match on either phone, show every registry pair, cover every organization.

### Actions Completed
- Drafted `sql/030_registry_identity_matching.sql`: `npi_identity_keys`, `registry_match_candidates`,
  `registry_match_builds`, `registry_match_big_buckets`, batched/sharded build functions, the
  `registry_review_queue` view, and a replacement `resolve_identity_match` that creates a missing group
  membership before merging (otherwise identical to 009).
- Added `scripts/nppes_ingest/registry_match.py` and CLI flags `--match-registry`, `--skip-registry-match`,
  `--match-max-bucket`; the rebuild now runs automatically after `--apply` / `--apply-run`, and is skipped
  with a message if sql/030 is not installed.
- Added unit tests (`scripts/tests/test_ingest.py`); 63 tests pass.
- Worker: `GET /admin/match-reviews?scope=registry&tier=&offset=&limit=` reads `registry_review_queue` one page
  at a time (default 25, max 100, ordered by NPI pair so Postgres can stop early, `hasMore` from one extra
  row). The default `scope=leads` is unchanged. Bulk merge now re-reads only the requested pairs from both
  queues instead of the whole queue. Cards also carry `officialPhone` and `isLead`.
- Admin tab: new "Compare: Leads / All providers" selector, server-paged "Show more", an "Official's phone"
  row, and "Not a lead yet" in the Claimed by row. 138 worker tests pass (4 new); app.js syntax-checked.
  No browser testing was done (per AGENTS.md); it needs a manual check after sql/030 is installed.
- Plan: `documentation/plans/REGISTRY_WIDE_IDENTITY_MATCHING_PLAN.md`.

### Database / System Result
Run by the user (not by Claude; the environment, branch or production, was not recorded here):
sql/030 installed, `python -m nppes_ingest --match-registry` completed. 387,258 organization NPIs keyed;
154,082 candidate pairs; 1,400 oversized key groups skipped (cap 25). All 10 pairs among the five Saadat
NPIs appear in `registry_review_queue` (official+phone, and state+official+phone for the three unclaimed
ones). Worker and frontend were pushed to main and the user confirmed the five show in the Admin tab.
Not yet checked: query speed of `registry_review_queue` as pages deepen, and what the 1,400 skipped groups contain.

### Safety Status
Additive tables and views; no leads, groups, ownership or decisions are changed. The one replaced function
(`resolve_identity_match`) behaves as before for NPIs that already have a group. The Worker admin queue
default scope still reads `identity_review_queue` exactly as before; the registry scope is opt-in in the UI
and reports "not installed" until sql/030 exists. Worker and frontend are not deployed.

## 2026-10-06 — Onboarded Sheet Leads Import: Qualification, Preservation, and Claim Execution

### Objective

Import and claim all qualifying leads from `BD MEETINGS 2026 - Onboarded (2).csv` into DME Desk Prospector (`public.leads`), assigning each lead to the respective opener while preserving existing rep claims, skipping solar and George-affiliated records, and maintaining complete business grouping and audit logs.

### Actions Completed

- **Filtering & Deduplication Analysis:** Evaluated all 58 rows from the Onboarded sheet.
  - Skipped 10 blank/divider rows lacking valid 10-digit NPIs.
  - Skipped 3 rows under campaign `SUB: Solar`.
  - Skipped 8 rows opened by George or mentioning George in meeting notes/closer comments.
  - Checked live database (`public.leads`): 24 candidate NPIs were already claimed in Prospector; preserved their existing ownership without modification.
- **Opener Resolution & Enriched Payload Assembly:**
  - Mapped Opener `Ben` -> Ben Arthur (`ben.arthur.wiz@gmail.com`).
  - Mapped Opener `Jimmy` -> Jimmy Pearson (`jimmy.pearson.wiz@gmail.com`).
  - Mapped Opener `Jane` -> Kaity James (`kaity.james.wiz@gmail.com`).
  - Assigned 5 unassigned/blank opener leads to admin Ben Arthur.
  - Enriched provider details (address, official legal name, taxonomy, authorized official) via `public.npi_records`.
  - Preserved Opener Summaries and Closer Notes in `lead.notes`.
- **Sequential Atomic Claiming:**
  - Executed claims 1-by-1 via `public.claim_leads(p_user_id, p_leads, p_actor_id, p_dry_run => false)` using Ben Arthur's admin identity as actor.
  - Avoided PostgREST statement timeouts while automatically linking identity groups (`group_id`).

### Database / System Result

- **13 new leads inserted and claimed** in `public.leads` with `status = 'Onboarded'`:
  - 11 claimed by Ben Arthur (`1134722390`, `1184202699`, `1255067385`, `1407691694`, `1497529606`, `1760247704`, `1114282688`, `1134620537`, `1396208633`, `1174356141`, `1598486631`).
  - 1 claimed by Jimmy Pearson (`1356024087`).
  - 1 claimed by Kaity James (`1679248447`).
- All 13 verified live in `public.leads`.

### Safety Status

- No data deleted or truncated. Existing reps' claims were left untouched.
- Group-aware constraints and audit trail (`claim_for_user`) respected.

## 2026-10-08 — Profile pictures for each person (sql/037)

### Objective

Let each person have their own picture next to their name, uploaded by an admin from Controls.

### Actions Completed

- **Upload** (Admin > Controls > Users > Edit): choose a picture; the browser crops it to a square and shrinks it to up to 320 px
  (under about 45 KB) before sending it, so nothing large is stored. Clicking any picture opens it larger. Remove puts the person back to initials.
- **Where it shows**: the header chip (picture and name), Team activity (By rep and User activity), the Controls user
  list and kudos log, kudos pop-ups (the sender's picture next to Caro), birthday and anniversary messages (Caro keeps the
  birthday pose and the person's picture sits beside her, for the person themselves and for teammates), and the Team
  calendar card on Today. Anyone without a picture shows a round badge with their initials.
- **Server** (`worker/src/repos/avatarRepo.js`, `worker/src/lib/buddy.js`, `worker/src/index.js`): `GET /buddy/avatars`
  (everyone active, with a picture if they have one) and `POST /admin/users/avatar` (admin only; png, jpeg or webp data URL
  up to 60,000 characters; blank removes it).

### Database / System Result

- New SQL file `sql/037_user_avatars.sql` (`user_avatars`, one row per person; a picture is removed by setting it to null,
  never by deleting the row). Rerun-safe. **Not run by Claude; to be run by the user.** Until it is, everyone shows
  initials and uploading says what it needs.
- Worker tests: all pass (new: picture validation, listing, setting, replacing and removing, and the missing table).

### Safety Status

- Additive only. Only admins can set a picture. Manual browser testing required.

## 2026-10-08 — Avatar: removed the weekly call goal and the digest; a clearer team mood

### Objective

Act on feedback: the team call goal is not wanted, the "Last week at a glance" block repeated what Team
activity already shows, and the mood chart was hard to read.

### Actions Completed

- **Removed** the weekly team call goal (the setting, the progress bar in the avatar's panel, the cheer, and
  `setTeamGoal`) and the "Last week at a glance" digest (the block in Controls, `GET /admin/buddy/digest`,
  `adminDigest`). Team activity remains the one place for call numbers.
- **Mood** (Controls > Avatar notes > "How the team is feeling"): replaced the small bars with a plain
  explanation of the question Caro asks, a summary of the last 7 days (Great, Okay, Rough with icons), and a
  table of each day's counts with a proportional bar. Still totals only, never names.

### Database / System Result

- No SQL. An old `team_goal` row in `buddy_settings`, if one was ever saved, is simply unused. Worker tests: all
  pass; the Worker was redeployed.

### Safety Status

- Removal of unused features and a display change; nothing in the database was touched. Manual browser testing
  required.

## 2026-10-08 — Caro: handover notes, reminders, bingo, gallery, quiet hours and more

### Objective

Name the avatar (Caro) and make her more useful during real work and more fun, without making her noisy.

### Actions Completed

- **Useful**: a note to tomorrow's you (written in her panel, or when she asks near the end of the shift, shown
  once at the next sign-in); a heads-up about 15 minutes before a callback or meeting; a nudge when three or
  more leads are in a good time to call right now (one tap starts call mode on them); a Team calendar card on
  Today with birthdays and anniversaries for the next seven days; a quiet-for-a-while nudge (twice a day at
  most); and an "on a roll" remark.
- **Fun**: a weekly bingo card (the same nine squares for everyone each week, mixed from twelve; a line or a full
  card earns a cheer and a badge); seasonal puzzles around Halloween, Thanksgiving and Christmas; a gallery of
  her poses where each look unlocks the first time she shows it and the person can pick her resting pose;
  short remarks after logging a call (five a day at most, 20 minutes apart); a goodbye as you sign out.
- **Considerate**: she is quieter on a day someone answers "rough" to the mood check-in (no challenge); she
  stays quiet for ten minutes after a phone number is tapped, and during quiet hours each person can set; an
  optional soft chime on wins (off by default).
- **Admin** (Controls > Avatar notes): a "Last week at a glance" digest: calls dialed (against the week before),
  thank-yous, team wins and the mood totals.
- **Server** (`worker/src/lib/buddy.js`, `worker/src/repos/buddyTeamRepo.js`, `worker/src/repos/buddyRepo.js`):
  `GET/POST /buddy/handover`, `POST /buddy/handover/seen`, `GET /admin/buddy/digest`; `/buddy/notes` also returns
  the week ahead.

### Database / System Result

- New SQL file `sql/034_avatar_handover.sql` (`buddy_handover`, one row per person). Rerun-safe, nothing dropped.
  **Not run by Claude; to be run by the user.** Everything else works without it.
- Worker tests: all pass (new: handover note, the week ahead, last week's range and the digest totals).

### Safety Status

- Additive only. The handover note is private to its owner. Bingo, poses, quiet hours and sound live in the
  browser. Manual browser testing required.

## 2026-10-08 — Avatar seasonal outfits and two new poses

### Objective

Use the new artwork: seasonal outfits for the avatar, and the wink and encouragement poses.

### Actions Completed

- Seven new images from the user, resized to 420 px WebP (`docs/avatar/bd-*.webp`, 44 to 69 KB each; the large
  originals are not committed). Her corner face wears the outfit for the time of year: Halloween from 24 October,
  Thanksgiving Monday to Friday of the fourth Thursday of November, Christmas 1 to 26 December, New Year 27
  December to 2 January, Valentine's 10 to 14 February. The daily greeting wears it too.
- Birthdays and Fridays have their own outfits (birthday on the person's own day, Friday when there is no season); only a work anniversary keeps the small icon.
- The wink pose joins the click-me surprise; the encouragement pose is used for a day with no calls and for the
  reply to a "rough" mood tap.

### Database / System Result

- Frontend only; no SQL, no Worker change.

### Safety Status

- Display only. Manual browser testing required.

## 2026-10-08 — Icons instead of emoji, and collapsible Admin sections

### Objective

Emoji looked rough next to the rest of the interface, and the Admin tab had long sections that could not be
folded away.

### Actions Completed

- **Icons** (`docs/uiicons.js`): a small set of line icons drawn in the current text colour (`uiIcon("name")`),
  used for the avatar's badges, reactions, section titles, accessory, mood buttons and wheel, and for the
  calendar, bell and streak marks in Today, Claimed and call mode. No emoji are left; the check mark
  in the match-review table is a plain text glyph.
- **Reactions** are now stored as words (`like`, `love`, `cheer`) rather than emoji; the admin sees them as
  "liked it / loved it / cheered". The team-win announcement text no longer has an emoji.
- **Collapsible sections** (`docs/adminfold.js`): in Admin, every block in Team activity and every section and
  sub-section in Controls folds from its heading (the Review queues already folded from their toolbars). What is
  folded is remembered on the computer. It watches the panels because they are redrawn often.

### Database / System Result

- No SQL. Worker tests: all pass. The Worker needs a deploy for the reaction words.

### Safety Status

- Display only, plus the reaction values (nothing was stored under the old emoji values yet). Manual browser
  testing required.

## 2026-10-08 — Avatar team features: puzzle, kudos, team goal, mood, scripts, wheel, sidekick

### Objective

More fun and more useful for the team: a daily puzzle, thank-yous between teammates, a shared weekly call goal,
a one-tap mood check-in, call scripts beside call mode, a reward wheel, a lead of the day and a stretch reminder.

### Actions Completed

- **Frontend** (`docs/buddy-fun.js`, plugged into `docs/buddy.js`): a daily puzzle that rotates between a riddle,
  a word scramble, quick maths and trivia (about 55 built in, the same one for everyone each day, answers
  checked in the browser, a hint after two tries, a solve streak and a Riddler badge); a wheel spin unlocked
  by hitting the daily goal; a lead of the day taken from the rep's going-cold leads; kudos; the team goal
  bar and a cheer when it is reached; a mood question at the start of the shift; a stretch reminder after two
  hours of continuous activity (twice a day at most, never in the last 20 minutes of the shift); and scripts
  beside call mode (matched to the lead's specialty). (A small sidekick that grew with the call streak was
  built and then removed at the user's request.)
- **Server** (`worker/src/lib/buddy.js`, `worker/src/repos/buddyTeamRepo.js`, `worker/src/index.js`):
  `GET /buddy/team`, `GET /buddy/scripts`, `POST /buddy/kudos`, `POST /buddy/kudos/seen`, `POST /buddy/mood`;
  admin `POST /admin/buddy/script`, `/admin/buddy/script/retire`, and `teamGoal` on `/admin/buddy/settings`.
  `GET /buddy/notes` now also returns the thank-yous not yet seen.
- **Admin > Controls > Avatar notes**: the weekly team goal, a scripts manager, a 14-day mood chart and the
  recent kudos.
- The team's call count is the number of phone taps recorded this week (`call_taps`, sql/029): every Call
  button and tapped number writes one. At most 5 kudos per person per day.

### Database / System Result

- New SQL file `sql/033_avatar_team.sql`: `buddy_kudos`, `buddy_mood` (one row per person per day) and
  `buddy_scripts`. Rerun-safe, nothing dropped or rewritten. **Not run by Claude; to be run by the user.**
  The team goal is stored as a row in `buddy_settings` (sql/032).
- Worker tests: all pass (new: kudos rules, daily limit and the missing-table case, mood, scripts, the goal
  and week start, anonymous mood totals).

### Safety Status

- Additive only. Scripts are retired, never deleted. Admins see mood only as anonymous daily totals, never who
  chose what. Puzzle, wheel and sidekick state are kept in the browser only. Manual browser testing required.

## 2026-10-08 — Avatar extras: wins, reactions, repeating notes, birthdays, challenges and badges

### Objective

Make the avatar more fun and more useful: cheer real wins, mark occasions, let people answer notes, and keep
people company in call mode, without turning into noise.

### Actions Completed

- **Wins** (`docs/buddy.js`, `worker/src/repos/leadsRepo.js`): a booked meeting and an onboarded lead each
  get a cheer (noticed where they are saved, so call mode, Today and Claimed are all covered). Optionally,
  an admin can switch on a team announcement: when a rep onboards a lead, everyone else sees "<name> just
  onboarded <company>!" for a day (never an error: a failed announcement can't break the status change).
- **Notes**: repeating weekly notes (every Monday, etc.); reactions (three emoji) and a one-line reply on
  any note, shown to the admin under each note; birthdays (month and day only) and work anniversaries,
  entered in Admin > Controls, announced to the person and their teammates.
- **Fun**: a daily mini-challenge, badges (kept on the device, not the server), a joke or fun fact of the
  day, a click-me surprise, a Friday weekly recap, a nap after ten idle minutes, a seasonal accessory, and
  a phone-pose helper with call tips beside call mode (it never pops up during a call).
- **Server** (`worker/src/lib/buddy.js`, `worker/src/repos/buddyRepo.js`, `worker/src/index.js`):
  `POST /buddy/react`, `POST /admin/buddy/person`, `POST /admin/buddy/settings`; `GET /buddy/notes` takes the
  person's own date for occasions.

### Database / System Result

- New SQL file `sql/032_avatar_extras.sql`: two columns on `buddy_notes` (`kind`, `repeat_weekday`) and three
  small tables (`buddy_reactions`, `buddy_people`, `buddy_settings`). Rerun-safe; nothing dropped or rewritten.
  **Not run by Claude; to be run by the user.** Before it is run, everything else works and the new
  features say plainly that they need it.
- Worker tests: all pass (new: repeating notes, reactions, birthdays and anniversaries, team announcements
  and their failure case, the admin's dates and switch).

### Safety Status

- Additive only. Notes are retired, never deleted. A birthday stores month and day only. The team
  announcement is off until an admin switches it on.
- Not built (needs data the app doesn't have): a cheer for a first claim in a new state, and a
  "comeback" badge. Manual browser testing required.

## 2026-10-08 — Avatar: greetings, milestones and notes from the admin

### Objective

Add a friendly avatar of the team lead to the app: it says hello, cheers on milestones and shows notes
(message of the day, or a note for one person), without getting in the way.

### Actions Completed

- **Avatar images**: eight poses supplied by the user in `docs/avatar/` (neutral, wave, thumbs up, party,
  thinking, sleepy, note, phone). The originals are 0.3 to 1.7 MB each, so 420 px WebP copies
  (`bd-*.webp`, 35 to 55 KB each, transparent) are what the app uses. The originals are not committed.
- **Frontend** (`docs/buddy.js`, styles in `docs/style.css`, `today.js` calls `dmeBuddy.onToday`):
  a small face in the bottom-right corner. It greets once a day (and says welcome back after 3 or more days
  away), reacts to the first call of the day, 10 calls, the daily goal and 5/10/20/30-day streaks (only when
  crossed, never for what was already true on load), and wraps up the day after 5 pm. At most three pop-ups
  a day (notes excepted), none during call mode, and each person can choose All, Big moments only, or Off by
  clicking the face. Clicking the face also shows a tip and the recent notes.
- **Notes** (`sql/031_avatar_notes.sql`, `worker/src/lib/buddy.js`, `worker/src/repos/buddyRepo.js`):
  `GET /buddy/notes`, `POST /buddy/seen`, and admin `GET/POST /admin/buddy`, `POST /admin/buddy/retire`.
  Admin > Controls > Avatar notes writes a note for everyone or one person, for 1 day to 1 month, optionally
  starting later. Each person sees it pop up once; retiring a note keeps the row.
- Before sql/031 is run, reading notes returns an empty list and writing says to run the file first. The
  greetings, milestones and tips need no database.

### Database / System Result

- New SQL file `sql/031_avatar_notes.sql` (two small tables, row-level security on, no access for browsers).
  **Not run by Claude; to be run by the user.**
- Worker tests: all pass (new: note validation, who sees which note, missing tables, retiring, marking seen).

### Safety Status

- Additive only; no existing table or data touched. Notes are never deleted. Pop-up counts and the
  avatar mode are kept in the browser only.
- Manual browser testing required.

## 2026-10-08 — A tap on a phone number counts as a call (claimed or not)

### Objective

Reps don't always press the Call button; tapping the number itself opens the phone app the same way,
but nothing was recorded, so those calls were missing from the counts. This includes numbers in
Prospect, before a lead is claimed.

### Actions Completed

- **Every tap on a phone link is recorded** (`docs/dialtrack.js`, `POST /leads/dial`): numbers in
  Prospect rows and opened cards, Claimed rows and cards, Today and call mode. Each tap is kept by
  person and NPI in `call_taps` (`sql/029_call_taps.sql`), so a lead that is not claimed (no row to
  write a note on) is still counted, and the tap is still there when the lead is claimed later. Two
  taps on one lead within two minutes are one call. The phone app opens at once; a failure to record is
  only logged.
- **Counting rule** (`callEvents` / `allCallEvents` in `lib/teamActivity.js`): a tap is a call; a call-log
  result is a call; a result written within 30 minutes after the same person's tap on the same lead
  is that tap's outcome and is not counted again; a later result, a second tap more than two minutes
  later, or someone else's result each count. Used by Today (calls today and this week, streak) and
  Team activity (calls per rep per week). The funnel's "contacted" stage still reads statuses and
  call-log lines only.
- **Before sql/029 is run:** a tap on your own claimed lead is written to its call log ("Dialed ..."),
  as in the first version; a tap on any other lead cannot be kept.

### Database / System Result

- **SQL to run:** `sql/029_call_taps.sql` (one small table, about 100 bytes a tap).
- Worker tests: all pass (new: unclaimed taps count, a tap pairs with the result after claiming, other
  people's taps are not mine, once-per-two-minutes, the fallback before 029).

### Safety Status

- Adds rows to its own table only; no lead data is changed. Manual browser testing required.

## 2026-10-08 — Search more: failed pages and a Rescan for unseen leads

### Objective

A search showed "266 left" but Search more said "No more leads found".

### Actions Completed

- **A page the database fails to return is no longer read as the end of the list**
  (`companyService.js`). It used to mark the whole search finished; now the position stays where it
  was, the failure is reported in the response (`searchErrors`) and in a message, and the next click
  retries. Setup errors (a SQL file not installed) are reported as before.
- **Rescan:** when the list says it has ended but the count still shows unseen leads, the button
  becomes "Rescan for N unseen". It reads the list again from the top (`rescan=true`), skipping every
  lead already seen, so a position that can no longer be trusted cannot strand leads. One rescan per
  search: if nothing turns up, the message says the rest belong to businesses already claimed through
  another location or owned by a teammate, and the count then settles.
- The response also reports how many rows the search scanned (`scanned`).

### Database / System Result

- No SQL. Worker tests: 126 pass (new: a failed page is not the end; Rescan skips the seen and ignores a stale "done" position).
- The exact cause of the reported case could not be confirmed from the data available; the two changes
  above cover both likely causes (a failed page lookup, a stale position) and make the next occurrence visible.

### Safety Status

- No data changed. Manual browser testing required.

## 2026-10-08 — Status clean-up, call mode results, default specialty, plan docs

### Objective

Make statuses meaningful (one short list instead of many spellings and throwaway values),
finish the approved dialer features, and correct the plan documents.

### Actions Completed

- **Status normalization** (`worker/src/lib/statuses.js`): a canonical list (new, called, voicemail,
  no answer, gatekeeper, callback, interested, follow up, not interested, do not call, plus the
  pipeline stages meeting booked, meeting held, contract sent, invoice sent, onboarded). Typed
  variants map onto it ("VM", "Voice mail", "left vm" all become voicemail; "NI", "DNC", "CBK",
  "Signed", "Closed Won" and so on). Every status a rep writes is tidied the same way; a status
  that says nothing ("x", "asdf", "test") is refused, and a typed "disconnected" is refused (use
  Send to Disconnected). Dropdowns and result chips list each meaning once.
- **Admin > Controls > Statuses**: every spelling in use with its lead count and a suggested
  target; pick what each becomes, apply, and an undo file (npi, old status, new status) downloads.
  `GET /admin/statuses`, `POST /admin/statuses/merge`. It changes only the status text, not the
  owner or last-updated time, and never merges anything into "disconnected". Existing data is
  changed only when an admin applies it; nothing was changed by this release.
- **Feature 1, call mode on Prospect:** result chips (Voicemail, No answer, Gatekeeper, Interested,
  Not interested, Disconnected) claim the lead, record the result and note, and move on; a 10 second
  Undo returns the lead to Prospect; Disconnected is confirmed and uses the existing disconnect path.
- **Feature 3, shuffle** in the call drawer (remembered; only the leads still to call are reordered).
- **Feature 4, default specialty** (`sql/028_default_taxonomy.sql`, `POST /admin/taxonomies/default`,
  Admin > Controls > Search defaults): ticked in a brand-new session only.
- **Feature 5**, a dot on the states where it is a good time to call (same rule as the filter).
- **Plan documents:** 106 machine-specific `file:///c:/Users/ben.arthur/...` links in 6 files are
  now relative links (every target checked); `FEATURE_PLAN.md`, `checklist.md` and the plans
  `README.md` corrected and updated; `sql/README.md` marks 020 to 027 as run and adds 028.

### Database / System Result

- **SQL to run (optional):** `sql/028_default_taxonomy.sql` for the starting-specialty setting.
  (025, 026 and 027 were run.)
- Worker tests: all pass (new: status rules, cleanup list, merge safety and undo data, status writes,
  default specialty).
- Not deployed or pushed by this entry.

### Safety Status

- No production data changed by the release itself; the status merge is an explicit admin action
  with a confirmation and a downloadable undo file.
- Manual browser testing is still required.

## 2026-10-07 — Server-side paging and filtering, going-cold nudges, local time

### Objective

Stop the browser holding every claimed lead (it slows down as a rep's list grows), nudge reps
about leads that have gone quiet, and show each lead's local time and whether it is a good
time to call.

### Actions Completed

- **Server-side paging and filtering** (`GET /leads/page`): the Claimed table loads one page
  (50 by default) at a time; status, search, "overdue only", "good time to call" and every sort
  are applied in the database, with a stable tie-break so no row is skipped or repeated between
  pages. The cards and tab badge use whole-list counts from the same call, so they stay exact.
  The search covers company, NPI, city, state and contact, and a 10-digit NPI also finds the lead
  whose business holds it as another location. A page navigator sits under the table; the 30 second
  refresh keeps your page.
- **Today is built on the server** (`GET /leads/today`, `lib/leadView.js`): the lists (How did it go,
  meetings today, callbacks, going cold, first calls), the numbers (calls today and this week,
  meetings held, streak), the pipeline, coming up and recent activity come from all of the rep's
  leads and are sent as just what the screen shows (lists are capped). The rep's own day, week and
  time-zone offset are sent so "today" and the streak follow their clock.
- **Notifications** read a short list (`GET /leads/due`: callbacks that are due and meetings in the next
  3 days), fetched once a minute only when notifications are on, instead of the whole list.
- **The quick-actions palette** and **Export CSV** ask the server when used (a search of 10 results;
  the full `leads/list`) instead of reading a list held in the browser.
- **Going cold** (Today): a lead with no call, note or status change for 14 days (changeable, 3 to 90),
  nothing scheduled, and not onboarded, refused or lost. Oldest first, with Call and Log result,
  "Call the coldest N", and a count in the hero line.
- **Local time and good time to call** (`docs/localtime.js`): each state's main time zone; calling
  hours 8 AM to 5 PM on weekdays (lunch hour marked as a poor time). A small coloured time sits in the
  Prospect, Claimed, Today and call mode locations, refreshes every minute, and its tooltip says when
  the lead's day opens. Claimed has a "Good time to call" filter; Today's "Start calling" puts leads
  that are open now first. A few states are split between zones (for example the Florida panhandle, west
  Texas), so those can be an hour off.

### Database / System Result

- No SQL to run. Reads only existing tables; no new indexes. (If Claimed ever feels slow for a rep with
  tens of thousands of leads, an index on `leads (claimed_by, is_disconnected)` would be the next step.)
- Worker tests: 111 pass (new: list parameters, the page query's filters, sort and range, due leads,
  Today's lists, going-cold rules, streak and day boundaries across time zones, local time rules).
- Not deployed or pushed by this entry.

### Safety Status

- No production data touched, no secrets or `.env` changed. Every query is scoped to the signed-in rep's
  own leads; the search text is stripped of wildcard and filter characters before it reaches the database.
- Manual browser testing is required: this changes how the Claimed table, Today, notifications and the
  quick-actions palette get their data.

## 2026-10-06 — Related businesses, pipeline funnel, sheet import and export

### Objective

Three product features: stop branches of one business being worked as separate leads
(related businesses), show where claimed leads get to (pipeline funnel), and give admins an
in-app version of the BD MEETINGS import plus CSV exports.

### Actions Completed

- **Related businesses** (`docs/related.js`): leads in the list on screen that share a phone
  number, or an owner's name in the same state, are marked "Related x N". The opened card lists
  the others and why (same phone, same owner); in Prospect "Select all N together" ticks them for
  one claim, and "Keep related together" (results toolbar) puts their rows side by side. Same
  marker in Claimed. It only looks at what is already loaded, so no extra searches. A number
  shared by more than 6 rows is treated as a switchboard, a one-word name is too weak to join on,
  and the existing branch merge and claim rules are unchanged.
- **Pipeline funnel** (Admin > Team activity, `GET /admin/funnel?days=`): claimed, contacted,
  meeting booked, meeting held, onboarded, with the step-to-step rate, by rep, specialty and
  state, for leads claimed in the last 30 or 90 days or all time. A lead counts at every stage it
  has reached (so an onboarded lead also counts as having had a meeting), from its status, its
  booked meeting and its call log (`lib/funnel.js`). "Onboarded" = status says onboarded, closed
  won, or signed.
- **Sheet import** (Admin > Controls): choose a CSV exported from a BD MEETINGS tab; rows are
  qualified by the import protocol (10-digit NPI, SUB and "mentions" exclusions as editable
  settings, optional skip of rows already marked SYNC, repeats), openers are mapped to reps, a
  dry run shows what would happen (imported, already theirs, blocked and by whom, held for
  review), then the import claims 5 at a time on behalf of each rep through the existing
  `POST /admin/claim-for-user`. A result CSV (with a SYNC column) can be pasted back into the sheet.
- **Worker, claim-for-user:** now carries a `status`, `notes` and `meetingOpenerNotes` into the lead
  (Section 5 of the BD MEETINGS sync plan), fills name, address, owner and specialty from
  `npi_records` for rows that only have an NPI, and supports `dryRun`. A normal claim from the search
  results is unchanged (status "new", no notes). Imported context is written as one call-log line
  starting "Imported from BD MEETINGS", which the team view and funnel do not count as a call.
- **CSV export:** admin export of all or one rep's claimed leads (`GET /admin/export/leads`), and an
  Export CSV button in Claimed for your own. Cells that start like a formula are neutralised.

### Database / System Result

- No SQL to run. Everything reads existing tables; the import writes through the same `claim_leads`
  function as every other claim.
- Worker tests: 99 pass (new: funnel stages and rates, status/notes carry-through, registry fill-in,
  dry run, CSV parsing and qualifying, export safety, related-business clustering).
- **Effect on the BD MEETINGS Apps Script:** once this Worker is deployed, any `status` and `notes` it
  already sends are stored on the lead instead of being dropped. The script itself lives in the
  BD MEETINGS repo and is not changed here.
- Not deployed or pushed by this entry.

### Safety Status

- No production data touched, no secrets or `.env` changed. Importing never takes over a lead someone
  else owns, and every claim records the importing admin as the actor.
- Manual browser testing is still required (use "Check what would happen" before a real import).

## 2026-10-06 — Password change, sign-in lockout, tidy-ups

### Objective

Now that admins create accounts with temporary passwords, let people choose their own,
slow down password guessing, and clear out leftovers from the earlier redesigns.

### Actions Completed

- **Change your own password:** `POST /auth/change-password` (current password, then a new
  one of at least 8 characters that differs from it). A "Password" link next to Sign out
  opens the dialog (`docs/account.js`). A wrong current password is a 400, not a 401, because
  the app treats a 401 as "your session ended" and signs out.
- **Temporary passwords must be replaced:** accounts an admin adds, or whose password an admin
  resets, are flagged `must_change_password` (the admin can untick it). Sign-in returns the
  flag, the app opens a dialog that can't be dismissed, and the Worker refuses every other
  request with a 403 until the password is changed (only change-password and logout are
  allowed), so it is not just a front-end rule.
- **Sign-in lockout:** 5 wrong passwords in a row lock the account for 15 minutes, even
  against the right password; a good sign-in resets the count; the lock lifts by itself. Admins
  see a Locked badge and can Unlock from Admin > Controls. Unknown usernames can't be locked
  (there is nothing to store it on); the existing 400 ms delay still applies to every failure.
- **Tidy-ups:** removed the dead CSS for the old "Lead quality and order" section and the old
  Today header (31 rules); deleted the unused DMEdesk logo files; moved
  `docs/bd-main-migration-plan.md` to `documentation/plans/` (docs/ is the published site).
- Left alone on purpose: internal names (repo, Worker URL, `dmedesk` source setting); the 4,000
  seen-leads cap per search (raising it grows `search_progress` on a size-limited plan); the
  uncommitted wrangler 3 to 4 change in `worker/package*.json`.

### Database / System Result

- **SQL to run (optional):** `sql/027_account_security.sql` adds three columns. Before it is
  run everything keeps working; there is just no lockout and no forced change.
- Worker tests: 82 pass (new: lockout rules, counting and reset, the lock lifting, flagged
  temporary passwords, removed accounts, behaviour before 027, password change rules).
- Not deployed or pushed by this entry.

### Safety Status

- No production data touched, no `.env` or secrets changed; passwords are only ever stored hashed.
- Ownership rules and the audit trail are unchanged.
- Manual browser testing is still required.

## 2026-10-06 — Admin Controls: add, edit and remove users, system panel

### Objective

Let an admin add users, change roles, reset passwords and remove users from the app, and
see what the app is connected to, instead of editing the `app_users` table by hand.

### Actions Completed

- **Admin > Controls** (`docs/controls.js`, third switch next to Team activity and Review
  queues): a users table (role, status, claimed leads, date added) with Add user and Edit
  dialogs, and a read-only System panel (which services are configured, which SQL files are
  installed, where leads are searched from). Keys and secrets are never shown, only whether
  they are set.
- **Worker routes** (admin only): `GET/POST /admin/users`, `POST /admin/users/update`,
  `GET /admin/system` (`repos/userAdminRepo.js`, `services/systemInfo.js`).
- **Adding a user:** username (3 to 40 letters, numbers, dot, dash, underscore), name,
  temporary password (generated, shown once), optional admin and claim-for-others roles.
  Passwords are stored as bcrypt hashes. Names must be unique and may not contain a colon or
  a long dash, because the call log is written as "time — name: text" and the team view
  reads the name back out of it. Names can't be changed afterwards for the same reason.
- **Removing a user is reversible, not a delete:** claimed leads and the append-only
  ownership history point at `app_users(id)`. Removal sets `disabled_at` (sql/026); the
  person can't sign in, and an open session stops working within about 30 seconds. Their
  leads stay assigned to them. Guards: you can't remove or demote yourself, and the last
  active admin can't be removed or demoted.
- **Fresh permissions on every request** (`lib/userGate.js`): the admin flag and removal are
  read from the database (cached 30 seconds per Worker instance) instead of the sign-in token,
  so demoting an admin takes effect in seconds, not at token expiry. If that lookup fails,
  requests carry on as the token says rather than locking everyone out.

### Database / System Result

- **SQL to run (optional):** `sql/026_user_controls.sql` adds one nullable column. Without it,
  everything except Remove / Restore works, and Remove explains what to run.
- Worker tests: 75 pass (new: user validation, duplicates, self and last-admin guards,
  remove/restore, role and password changes, the pre-026 behaviour, the per-request gate).
- Not deployed or pushed by this entry.

### Safety Status

- No production data touched, no secrets or `.env` changed; passwords are never logged or stored in clear.
- Ownership rules and the audit trail are unchanged; no user row is ever deleted.
- Manual browser testing is still required.

## 2026-10-06 — "Search more" lost leads, Territory timeout, call mode and expanded-row redesign

### Objective

Find why a search said "451 left" and then "no more leads" on Search more, make the lead
counts shown in the app trustworthy, stop the Territory map timing out, improve call mode,
and make an opened lead replace its small row instead of repeating the company name.

### Actions Completed

- **Root cause of "451 left, then no more leads"** (`worker/src/services/companyService.js`):
  each fetch reads a page of 200 providers, but after showing the requested 20 the saved
  position still advanced by the whole page, so the other ~180 rows were never shown by any
  later "Search more". "Left" counts every unseen provider, so it stayed high while paging
  ran off the end. Reproduced with a test (450 providers, only 60 reachable); the position
  now advances by the rows actually looked at, and "done" is reported only when every query
  has run out of rows (it used to be inferred from how many leads were shown).
- **Saved positions from before the fix** are discarded once (`searchProgressRepo.js`,
  stamped `_v: 2` in `search_progress.variant_skips`). What a rep has already SEEN is kept, so
  nothing is shown twice; the search simply re-reads from the top, skipping seen rows, and
  reaches the rows the old paging dropped.
- **Counts shown in the app:** Prospect cards now total every page fetched (the sub-line says
  how many are on the current page); the Claimed "Reminders due" card counts everything due by
  the end of today (it used to mean "within 24 hours" while the label said "today");
  Today's calls, week and streak follow the rep's own clock (call-log stamps are UTC); the
  "left for you" figure explains that a business a teammate owns through another location is
  only spotted as you page, so it can read a little high.
- **Territory timeout:** `search_territory()` counted every enabled specialty in one statement,
  visiting the table for each provider to read its state. New `sql/025_territory_cache.sql`:
  a small `territory_totals` table recounted one specialty at a time (`refresh_territory_code`),
  and `search_territory()` reads it and subtracts claimed/disconnected leads live. The Worker
  refreshes missing or week-old specialties two at a time within 20 seconds and reports
  `pending` for the rest; the dialog says to reopen it. Without 025 the old count is used.
- **Call mode:** Back, an "Up next" list to jump around in, every phone number on file for a
  lead, Medicare claims / website / booked-meeting chips, Book a meeting (Claimed), keyboard
  shortcuts (left/right, Ctrl+Enter, Esc), live logged/skipped/left counts, a summary that
  breaks results down by status, and "Go through skipped".
- **Expanded lead:** the small row is hidden while its card is open; the card header (big
  name) collapses it again, carries a select checkbox, and returns focus to the row.

### Database / System Result

- **SQL to run:** `sql/025_territory_cache.sql` (creates one tiny table and replaces
  `search_territory()`; reviewed against an in-memory Postgres test, not run on Supabase).
- Worker tests: 66 pass (new: paging reaches every provider, bookmark migration, territory
  refresh and fallback). SQL test: 50 pass.
- Not deployed or pushed by this entry.

### Safety Status

- No production data touched, no `.env` or secrets changed.
- 025 writes only its own derived table; claim and ownership rules and the audit trail are unchanged.
- Manual browser testing is still required.

## 2026-10-05 — Today screen, call mode, "How did it go?", contacted-before warnings, Team activity

### Objective

Give reps a "what do I do now" landing screen and fewer clicks per call, finish the
meeting feature with an outcome step, warn when a Prospect lead was already worked, and
give admins a per-rep activity view. Also tidy the search panel: Sort and the
"only show" boxes move to the results table, the ZIP field goes, quick picks stay in view.

### Actions Completed

- **Today** (`docs/today.js`, new first tab and the screen after sign-in): "How did it
  go?" (meetings that have passed), meetings today with the rep's opener notes, callbacks
  due, and claimed leads waiting for a first call. Built from the claimed leads the app
  already loads; no new endpoint. The tab badge counts what needs attention.
- **How did it go?** (Today): Went well / No-show / Reschedule. Went well and No-show
  clear the meeting through `POST /leads/meeting` with a blank `meetingAt` and a new
  `outcome` of `held` or `no-show`, so the call log reads "Meeting held" / "Meeting
  no-show" instead of "Meeting cancelled". The dialog then sets a status, an optional note
  and the next callback with the existing status, notes and reminder endpoints. Reschedule
  opens the existing meeting dialog.
- **Call mode** (`docs/callmode.js`): a right-hand drawer that steps through checked leads
  one at a time. Claimed leads: Call, result chips, note, callback, Save & next (same three
  calls as the call log). Prospect leads: Call, Claim & next or Skip (same claim endpoint
  and rules). Started from the checked rows of either table, or from Today.
- **Contacted before** (Prospect): the Worker adds `priorContact` (status, date, rep, last
  note) to results that were claimed and worked earlier and then returned to Prospect
  (`attachPriorContactSafe`; best effort, results are unchanged if the lookup fails). The
  row shows a badge and the opened card a banner. Leads a teammate holds or that are
  disconnected stay hidden from search as before.
- **Team activity** (`docs/team.js`, Admin tab, new `GET /admin/team-activity`, admin
  only): calls, meetings held/booked, claims per rep and per week, open leads, overdue
  callbacks and meetings ahead. Claims come from `lead_ownership_events`; calls and
  meetings are read from the dated lines of each lead's call log
  (`worker/src/lib/teamActivity.js`). The Admin tab has a switch between Team activity and
  the existing Review queues.
- **Search panel:** Sort and "Phone number / Decision maker / Active Medicare biller" now
  sit above the results table (still part of the search form; changing one re-runs the
  search). The "ZIP starts with" field is removed (a 5-digit ZIP typed in the lookup box
  still filters). Quick picks are always visible instead of inside a collapsible section.
- Tests: `worker/test/teamActivity.test.js` (note parsing, weekly bucketing, "Other" bucket,
  prior-contact summary, meeting outcome) and an updated `meetings.test.js`. 58 Worker
  tests pass; `wrangler deploy --dry-run` builds.

### Database / System Result

- **No SQL to run** and no schema change. Everything reads existing tables (`leads`,
  `lead_ownership_events`, `app_users`). The new route only reads; the only write path
  touched is the existing meeting endpoint, which now accepts an optional `outcome`.
- Worker and frontend are not deployed by this entry; deployment is recorded separately.

### Safety Status

- No production data was touched, no secrets or `.env` changed.
- Append-only audit behaviour and claim/ownership rules are unchanged: call mode claims
  through the same endpoint and rules as the Claim button, and Team activity is read-only.
- Team activity counts what reps wrote in call logs, so a rewritten note changes that
  rep's own history; the view says so.
- Manual browser testing is still required (no automated browser testing in this repo).

## 2026-10-05 — Scoring removed; search switched to DME Desk's own table for everyone

### Objective

Remove lead scoring completely (it only measured how complete a provider's data was),
read search from DME Desk's own provider table for all reps, and make sure a deploy
can never silently undo that setting.

### Actions Completed

- **Scoring removed:** Worker (`lib/scoring.js` deleted, no scoring in search, the
  call-brief prompt, lead inserts or the DTO), frontend (score column, ring, tooltip,
  badges, "High fit" and "Average score" cards, "why this lead" tags, minimum-score
  filter, "best fit first" sort, "High fit" quick pick, and the dead CSS), and SQL
  (`sql/024_remove_scoring.sql`, **not yet run**: replaces `provider_filter_sql()` and
  `search_providers_v2()` without score, drops `provider_score_sql()`; functions only).
- **Kept deliberately:** `leads.score_value` / `score_percentage` columns and data
  (dropping a column is irreversible); the Google Sheet "Score" and "Score %" columns,
  written empty, so later columns keep their positions for external readers.
- **Deleted before ever being run:** the stored-score table work (`sql/023_*`, which
  measured 125 MB, then ~47 MB, on a 500 MB free plan). No longer needed.
- **Source switch:** `worker/wrangler.toml` now has `keep_vars = true` and
  `[vars] NPI_SOURCE = "dmedesk"`. Every DME Desk search uses `search_providers_v2()`;
  a specialty with no code matches nothing; "Search more" bookmarks are kept per source
  (a rep's first DME Desk search restarts at the top but skips what they had seen; their
  mirror bookmarks are untouched, so rollback loses nothing).
- New defaults: sort is "Default order" (NPI order, fast); other sorts are Medicare
  activity, recently updated and name. Prospect gained a Specialty column.
- Tests: Worker 51 pass; SQL 44 checks (021, 022, 024 in order) on a throwaway
  Postgres; frontend linted with ESLint (no undefined or unused names).

### Database / System Result

- **No SQL was executed by the agent.** `sql/024` is functions-only and is run by the
  project owner. No data was changed or deleted.
- Worker deploy changes which source every rep's search reads from.

### Safety Status

- Claim, ownership and audit logic untouched. Old saved bookmarks are never modified.
- Rollback: set `NPI_SOURCE` to `"mirror"` in `wrangler.toml` and deploy.

## (earlier the same day) Smarter Prospect search (counts, quality filters, sorting, lookups) — live for admins (trial)

### Update 4 (same day): lean stored scores, light-theme contrast, specialty

- Free-plan size concern: the first `provider_scores` design measured 125 MB on a
  real Postgres with 380,000 realistic rows. Redesigned to ~47 MB (two small
  `(key, score)` indexes plus an exact two-step page lookup) and added
  `sql/023_provider_scores_uninstall.sql`. 023 is still **not run**. SQL tests:
  175 checks (including exact equality with the live search over ~100 filter and
  page combinations, edge pages, and the uninstall path); earlier suites still pass.
- Light theme rebuilt for contrast: tinted page/sidebar/table headers, white
  cards with visible borders and shadows, and colored text darkened until every
  pair clears the 4.5:1 readability minimum (the green status text was 3.0:1 on
  its own tint and white on the bright teal button 3.8:1). Checked numerically.
- Specialty: its own sortable column in Prospect and a visible tag in Claimed.
- No data changed; no deploy of the Worker needed (unchanged this round).

### Update 3 (same day): stored fit scores

- Measured the sorted search on the live database: 4.3 s cold, 0.18 s warm, on a
  Nano instance; the plan was correct, so the cost is scoring ~8,400 wide rows
  per search on a machine that cannot keep them cached.
- Added `sql/023_provider_scores.sql` (**not run**; optional): a narrow
  `provider_scores` table, stale-marking triggers, `refresh_provider_scores()`
  and a stored-score path inside `search_providers_v2()`. It is used only when
  fresh and only for searches it can answer exactly; otherwise nothing changes.
- Worker reports whether the stored scores are fresh (`/search/capabilities`).
  Tests: SQL 151 + 39 checks on a throwaway Postgres; Worker 50 pass.
- No data was changed. Follow-up: call `refresh_provider_scores()` from the
  monthly ingest.

### Update 2 (same day): layout, Territory and speed

- Search panel decluttered and made non-sticky (it covered the results table);
  quality filters, sort and quick picks in one collapsible section; source switch
  moved to the header; Territory redesigned with "Best bets".
- Added `sql/022_search_speed.sql` (**not run**; optional) and Worker changes that
  work with or without it: one-call quick-pick counts with a fallback, "at least"
  flags on capped counts, and a 30-second cache for identical count questions.
- SQL test: 39 checks with 021 and 022 installed on a throwaway Postgres.
  Worker tests: 48 pass.
- No data was changed.

### Update (same day)

- `sql/021` was run by the project owner. Worker deployed as version
  `b14c364c-c4f3-4887-b682-badb40849291`; frontend pushed.
- Added an **admin-only trial**: `X-Search-Source: dmedesk` is honoured for admin
  sessions only (`worker/src/lib/sourceTrial.js`), so admins can search DME Desk's
  own provider table while everyone else stays on the mirror. `NPI_SOURCE` is
  still unset on the live Worker (verified by comparing the bindings of the
  versions before and after this deploy: no plain-text variables existed).
- Worker tests: 45 pass across 6 files. No data was changed.
- Findings from the source comparison and the open items before a full switch
  are in `documentation/plans/SEARCH_INSIGHTS_PLAN.md`.

### Original entry (written before deployment)

### Objective

Stop reps guessing which filter combinations still hold leads: show how many
are left for them, explain and fix empty searches, add quality filters and
sorting that apply before paging, and widen the lookup box.

### Actions Completed

- `sql/021_search_insights.sql` (new, **not run**): read-only `search_insights()`,
  `search_territory()`, `search_providers_v2()`, `search_features()` and helpers.
  `search_providers()` (018) is untouched. Tested on a throwaway in-memory
  Postgres: `sql/tests/021_search_insights.test.mjs`, 35 checks.
- Worker: `lib/searchFilters.js`, `services/searchInsights.js`, new routes
  `GET /search/capabilities`, `/search/insights`, `/search/quickpicks`,
  `/search/territory`; `providerSearch.js` routes searches that use the new
  options to v2; `companyService.js` runs a sorted/filtered search as one query
  and keeps the database's order; phone and text lookups are one query with no
  paging memory. Searches using none of the new options take the original path.
- Search-progress fingerprints gain the new options only when set. Verified
  byte-identical to the committed version for existing-style searches.
- Frontend: availability line, suggestions, quick picks, progress bar, territory
  explorer, saved-search "new since" badges, quality-filter controls, sort
  select, and the smart lookup box (NPI / phone / ZIP / name or owner).
- Worker tests: 40 pass across 5 files (new: searchFilters, searchFlow, meetings).

### Database / System Result

- **No SQL was run and nothing was deployed.** All new database functions are
  read-only and rerun-safe; they write no table.
- Until `021` is run and searches read from DME Desk's own table
  (`NPI_SOURCE=dmedesk`), the new controls stay hidden and search is unchanged.

### Safety Status

- Claim, ownership and audit logic untouched. New functions are `security
  definer` with execute granted to `service_role` only, like 018. Every value
  reaches SQL through `%L` quoting (an injection attempt is a test case).
- Exclude keywords are never offered as a one-click "loosen" suggestion.

## 2026-10-05 — Lead cards v2, status/call-log merge, meetings (first slice)

### Objective

Make the expanded lead card useful on a call, stop status and "log call" from
repeating each other, and let reps book a meeting with a reminder, a contact
email and private opener notes.

### Actions Completed

- Prospect card: "Who to call" + "Company" with one filled Call button, the
  score as a small header badge, plain-language "why this lead" tags.
- Claimed card: "Log this call" work mode. The result chips are the lead's
  statuses, so one Save sets the status, writes the call-log entry, and can
  set a callback reminder; the table's status dropdown stays in sync.
- Meetings: `sql/020_lead_meetings.sql` (new, **not run**), Worker route
  `POST /leads/meeting`, `worker/src/lib/meetings.js` with tests, a booking
  modal, card section, Reminder-column badge, and notification. See
  `documentation/plans/MEETINGS_PLAN.md`.
- Fixed a regression from the sidebar CSS that showed the Admin tab to
  non-admins (the Worker already refused their admin requests).

### Database / System Result

- **`020` run by the project owner** in the Supabase SQL Editor, in the
  project the Worker uses (reported 2026-10-05; the agent did not run it and
  has not independently verified the result). It is additive (five nullable
  columns, check constraints, one trigger). An attempt to run it through the
  agent's Supabase connector was stopped: the only project that connector can
  see (`saleooperations`, ref `gnhwfulkkogtwqygmekg`) is a different
  application, so nothing was executed there.
- **Worker deployed 2026-10-05** (`dmedesk-prospector-api`, version
  `cabe0ccd-2edb-4668-9dbc-16e59889d338`). Until `020` is run, `POST
  /leads/meeting` answers 503 "Meetings aren't installed yet". Unauthenticated
  calls return 401 like the other lead routes.
- Worker tests: 23 pass (7 new for meeting validation).

### Safety Status

- No append-only table, claim, or ownership rule touched. Meeting data is
  cleared by trigger when ownership changes. No secrets involved.
- Frontend for cards v2 / status merge / meetings pushed after `020` was run.
  Manual browser verification of the live site is still pending.

## 2026-10-02 — Frontend UI refresh (sidebar dashboard + expanding lead cards)

### Objective

Modernize the browser UI: sidebar navigation with a dashboard feel (option B)
and card-style lead details that expand directly below the lead row (option C).

### Actions Completed

- `docs/index.html`: tabs became an icon sidebar with a Claimed count badge;
  added KPI strips (Prospect and Claimed), a collapsible filter bar with
  removable filter chips, a floating selection bar, and a Ctrl/Cmd+K quick
  actions palette. Cache-bust versions bumped (style v38, app v40).
- `docs/app.js`: lead detail rows now render as cards (header with avatar,
  call/website/brief actions; score breakdown, details, contacts, branches;
  Claimed adds reminder, meeting, call log). Existing data hooks and element
  ids (`data-brief-index`, `data-reminder-index`, `data-book-meeting-index`,
  notes handlers) are unchanged.
- `docs/style.css`: new rules appended at the end of the file; existing rules
  were left in place and layered over.
- Follow-up passes the same day: Inter + Plus Jakarta Sans typography, a
  rebuilt dark theme, cropped logo, removal of the "still being developed"
  banner, collapsible sidebar (remembered per browser), empty states, colored
  status pills, row signal icons and hover quick actions (copy phone, open
  site), saved searches and a Claimed column chooser (both stored in browser
  localStorage only), overdue-callback strip, comfortable/compact density,
  KPI skeletons and count-up, and a "last refreshed" label.

### Database / System Result

- No API, SQL, migration, or production data change. Frontend files only.
- Not deployed. Manual browser verification is still pending.

### Safety Status

- Claim/ownership logic, append-only audit behavior, and secrets untouched.
- Selection-bar and palette actions call the existing handlers; they add no
  new write paths.

## 2026-09-29 — Ownership-safe bulk merge for possible duplicates

### Objective

Allow admins to bulk-merge only possible-duplicate pairs whose current
ownership is unambiguous, while preserving an audit reason for every merge.

### Actions Completed

- Added Admin → Possible duplicates selection checkboxes and “Select all
  eligible” behavior across the full filtered queue, not only the visible page.
- Excluded cross-agent pairs from bulk selection while leaving the existing
  manual review action available.
- Added an admin-only Worker bulk-merge route that revalidates ownership on
  the server and processes pairs sequentially through the existing atomic
  `resolve_identity_match()` RPC.
- Generated automatic audit reasons for both-unclaimed, unclaimed/agent, and
  same-agent pairs; no ownership is changed by the merge.
- Added Worker unit coverage for the ownership eligibility and reason rules.
- Reconciled `MASTER_PLAN.md` with `sql/README.md`: migrations 005, 006, 008,
  009, and 010 are recorded as executed on 2026-09-16. Provider-refresh apply,
  Medicare follow-up, preflight/import, and remaining ownership APIs remain
  open work.

### Database / System Result

- No SQL migration or production data was changed.
- Each bulk pair still uses the existing append-only identity decision table
  and atomic merge function.

### Safety Status

- Server-side admin authorization and ownership revalidation are enforced.
- Cross-agent pairs are not eligible for bulk processing.
- Deployment and browser verification remain manual handoff steps.

## 2026-09-22 — Documentation structure and freshness audit

### Objective

Make the documentation tree unambiguous and distinguish current guidance from
historical planning notes, especially between `plans/` and `planning/`.

### Actions Completed

- Added `documentation/README.md` as the documentation index and status guide.
- Clarified that `plans/` holds stable specifications while `planning/` holds
  active or historical working notes.
- Updated the master plan, active checklist, and provider-refresh plan status
  dates and current search-cutover wording.
- Marked older findings, progress, and dated planning notes as historical.
- Corrected several relative links that incorrectly repeated
  `documentation/` or pointed from the wrong directory.
- Updated the repository README so the live Worker/Supabase architecture is
  no longer described as a migration in progress.

### Database / System Result

- No database, Worker, frontend, or SQL behavior changed.
- No production configuration or data was changed.

### Safety Status

- Documentation-only changes.
- Historical documents were retained rather than deleted.
- Remaining machine-specific links are confined to older historical notes and
  are tracked for a later link-cleanup pass.

## 2026-09-22 — Internal provider-search cutover handoff

### Objective

Document the remaining work needed to switch production search from the
fakeNPI HTTP mirror to the internal DME Desk provider-search implementation.

### Actions completed

- Added `documentation/operations/INTERNAL_PROVIDER_SEARCH_CUTOVER_HANDOFF.md`
  with the database, taxonomy, comparison, configuration, and rollback steps.
- Updated the Phase 3 section of `documentation/plans/MASTER_PLAN.md` to
  reflect that the internal Worker path is built and only production cutover
  remains.
- Updated `sql/README.md` so `018_provider_search.sql` is marked as awaiting
  production verification rather than describing the repository implementation
  as missing.

### Database / System Result

- No Docker commands were run.
- No SQL was executed.
- No Cloudflare variables were changed.
- Production remains on the mirror source until the laptop handoff steps are
  completed.

### Safety Status

- No data was deleted or modified.
- No production search behavior was changed.
- Rollback remains available through `NPI_SOURCE=mirror`.

## 2026-09-22 — Fix legacy taxonomy code resolution

### Objective

Prevent enabled taxonomy options shown by the frontend from being sent to
NPPES as rejected `taxonomy_description` values when their database row has a
blank Description column.

### Actions completed

- Updated `worker/src/repos/taxonomiesRepo.js` so description-to-code lookup
  falls back to `facility_type`, matching the frontend's `description ||
  facility_type` behavior.
- Kept code-based searching as the preferred path, including for legacy rows.
- Added a separate fallback lookup for unresolved facility-type labels without
  changing taxonomy data or executing SQL.

### Database / System Result

- No database records or schema were changed.
- Legacy rows with a valid code can now resolve to exact code searches instead
  of falling through to NPPES `taxonomy_description` validation.

### Safety Status

- No data was deleted or overwritten.
- The change is limited to taxonomy lookup behavior; existing non-legacy
  description lookups remain unchanged.

## 2026-08-31 — Identity grouping foundation

### Objective

Prepare stable provider identity grouping and ownership history without
breaking the existing application flow.

### Actions completed

1. Reviewed `MASTER_PLAN.md`, architecture notes, migration notes, and current
   Worker repositories/routes.
2. Confirmed `worker/` is the active implementation.
3. Confirmed the Supabase project link was initially pointing at fakeNPI, then
   linked/used the DME Desk project containing `app_users`, `leads`, and
   `npi_records`.
4. Ran the read-only schema checkpoint.
5. Verified all required NPPES identity columns exist.
6. Manually applied `sql/001_identity_schema.sql`.
7. Verified the new tables, `leads.group_id`, indexes, RLS, and audit triggers.
8. Prepared the safe backfill SQL.
9. Manually ran `sql/002_identity_backfill_safe.sql`.
10. Ran read-only verification queries.
11. Identified two pre-existing group-level ownership conflicts for manual
    review.

### Database result

- 4,599 leads checked.
- 0 leads without a group.
- 4,495 unique NPIs and 4,495 group memberships.
- 4,168 strict groups.
- 315 singleton groups.
- 0 duplicate NPI memberships.
- 3,494 historical claim events.
- 0 claimed leads missing a historical claim event.
- 2 groups contain active claims owned by multiple users.

### Important scope clarification

The current grouping logic exists in SQL as a one-time deterministic backfill.
Reusable JavaScript grouping/preflight code has not been implemented yet.
Tier 2 RapidFuzz review generation has also not been implemented.

### Safety status

- No existing claims were reassigned.
- No leads were deleted.
- No existing provider fields, statuses, notes, reminders, or owners were
  overwritten.
- Existing Worker routes were not changed.
- Supabase schema and backfill SQL were manually executed; no application
  deployment or commit has been made by this worklog.

## 2026-09-02 — NPPES ingestion CLI and ownership-conflict resolution

### Objective

Build the NPPES ingestion tooling, record the two approved owner decisions,
and give every remaining ownership conflict a place in the admin UI.

### Actions completed

1. Built `scripts/nppes_ingest`, a dependency-free Python CLI: argparse
   entry point, canonical normalization, NPPES header mapping, CMS
   check-digit validation, duplicate/state/taxonomy filtering, row-count
   guard, source checksum, run manifest, rejects report, batched staging
   upload, and rollback on partial failure.
2. Wrote `sql/004_nppes_refresh_staging.sql`, the staging table the CLI
   targets, with its own read-only verification queries.
3. Wrote `sql/005_ownership_conflict_resolution.sql`:
   `resolve_ownership_conflict()` (transactional, row-locking, append-only
   audit) and the `ownership_conflicts` view.
4. Wrote `sql/006_resolve_known_conflicts.sql` carrying the two approved
   owner decisions, targeting groups by member NPI rather than by name.
5. Added `GET /admin/conflicts` and `POST /admin/conflicts/resolve` to the
   Worker, with the approver taken from the session.
6. Added the ownership-conflict queue and resolve modal to the Admin tab.
7. Updated `MASTER_PLAN.md`, `ARCHITECTURE.md`, and `sql/README.md`.

### Test results

- 24 unit tests pass (`python3 -m unittest discover -s scripts/tests -t scripts`).
- CLI verified end to end in `--dry-run` against a fixture: 7 source rows,
  3 accepted, 4 rejected with the expected reason codes, manifest and
  rejects report written.
- Admin UI driven in headless Chromium against mocked API responses: both
  conflicts render, no owner pre-selected, missing-owner and missing-reason
  both blocked client-side, correct resolve payload posted, modal closes.
  Empty, not-installed and API-failure states verified; light and dark.
- `node --check` clean on every changed JavaScript file.

### Database result

None. No SQL was executed against Supabase — `004`, `005` and `006` are all
awaiting manual execution by the project owner.

### Safety status

- The two conflict decisions are recorded but **not yet applied**; no claim
  has moved.
- The ingestion CLI cannot write `npi_records` or `leads` by construction.
- Listing conflicts required no new SQL, so the admin queue degrades to an
  explanatory message rather than an error if the identity schema or the
  resolution function is missing.

### Important scope note

The transactional apply step (staging → compare → `provider_field_history`
→ `npi_records`) is **not** built. Staging a release does nothing to live
provider data on its own, which is the intended safety property, but it also
means a staged release is not yet useful until that step exists.

## Next worklog entry

Run `sql/004`, `005` and `006` (editing the approver username in `006`
first), verify with the queries in each file, then build the transactional
apply step and rehearse it against a small real release.

## Older next-entry note (2026-08-31, superseded)

The next implementation should add reusable grouping/preflight code and tests,
then add atomic group-aware claiming only after the two ownership conflicts have
explicit owner decisions.


## 2026-09-09 — Local migration verification and remote history reconciliation

- Pulled the linked Supabase schema into `supabase/migrations/20260909151917_remote_schema.sql`.
- Started the local Docker Supabase stack and reset the local database with the pulled migration.
- Confirmed local migration history and direct local/remote schema comparison are clean; local and linked lint reported no schema errors.
- Created `supabase/backups/remote-20260909-1825.sql` before further work. This is a schema backup, not a full production data backup.
- Did not execute the pulled schema snapshot against production because it represents objects already present in the cloud database, rather than a new schema change migration.
- Reconciled the remote migration-history row `20260909151917` as applied without executing SQL against the production schema.
- Production schema was not changed in this step.

### Next implementation step

Build the reusable grouping/preflight layer and dry-run intake report. After that, create a narrowly scoped migration only for any genuinely new schema required by the intake/claim workflow, test it locally, take a full production backup, and apply it through the reviewed deployment path.

## 2026-09-17 — Database storage quota recovery, SQL immutability audit, and BD Meetings sync plan

### Objective
Diagnose and resolve the Supabase storage quota overage (742 MB / 500 MB), diagnose the return-to-prospect SQL immutability crash, audit "Send to Sheets" and Claimed tab merges against grouping rules, and plan the BD Meetings NPI sync.

### Actions completed
1. **Database Storage Quota Diagnosis & Truncation**:
   - Identified that 84% of database storage was consumed by `provider_field_history` (294 MB data + 31 MB index) and `nppes_refresh_staging` (223 MB data + 33 MB index).
   - User truncated temporary staging tables in the Supabase SQL Editor.
   - Database size dropped from 0.742 GB (148%) to 0.488 GB (98%), clearing the immediate quota overage and lifting read-only restriction risks.
   - Formulated a 5-step permanent prevention strategy in `documentation/planning/sept17.md` (auto-purge staging in `finish_nppes_apply`, eliminate bulky `record_created` JSON dumps, add CLI preflight storage guard at 350 MB, post-apply vacuuming, strict taxonomy pre-filtering).
2. **SQL Immutability Error Diagnosis (`returnClaimedLeadsToProspect`)**:
   - Identified root cause of `Failed to return leads to Prospect: append-only audit table: lead_ownership_events is immutable`:
     - `leadsRepo.js` line 427 executed a hard `DELETE FROM leads`.
     - `lead_ownership_events.lead_id` foreign key with `on delete set null` attempted an internal `UPDATE`, tripping `lead_ownership_events_append_only` trigger (`reject_audit_mutation()`).
   - Designed atomic `release_claimed_leads()` SQL RPC to soft-release leads (`claimed_by = NULL`, `status = 'new'`) and append a `'released'` audit event instead of hard-deleting rows.
   - Verified that soft-releasing aligns with `owned_group_npis` and existing group ownership checks (`WHERE not is_disconnected AND claimed_by IS NOT NULL`).
3. **Audit of Claimed Tab Merges & Send to Sheets**:
   - Audited `docs/app.js` and `worker/`: confirmed Claimed tab currently lacks multi-location grouping; designed join with `lead_groups` to display `locationsBadge` and branch accordions.
   - Audited `POST /export/google-sheet`: documented that "Send to Sheet" currently bypasses Supabase claim checks and drops merged branch locations in `flattenCompany()`.
4. **BD Meetings Auto-Claim Integration Plan**:
   - Specified implementation of `POST /admin/claim-for-user` route in `worker/src/index.js` using `sql/011`'s `claim_leads` RPC.
   - Outlined Script Properties and 30-minute sync trigger configuration for `BD MEETINGS 2026/src/code.js`.
5. **Agent Operating Guidelines**:
   - Documented markdown and worklog maintenance protocols in `agents.md`.

### Safety status
- Core sales pipeline (`leads`, `app_users`, `lead_groups`) was untouched during staging truncation.
- Production schema was not altered during this session.
- Staging table truncation removed only temporary ingest rows, not active provider registry records (`npi_records`).

## 2026-09-22 — Meeting safeguards, booking action, and Apps Script push

### Objective

Implement the requested BD meeting warnings, correct the spreadsheet NPI/sync columns, standardize calendar hyperlinks, add immediate booking from Prospector claimed leads, and push the Apps Script changes.

### Actions Completed

- Updated `BD MEETINGS 2026/src/code.js` with a confirmation warning for `Rescheduled → NI` and cancellation when not confirmed.
- Added scheduling validation for the checkbox, valid 10-digit NPI, and meeting time; corrected Prospector sync to NPI column S and sync column T.
- Changed spreadsheet calendar labels to `EEE h:mm a` and modern `/calendar/u/0/r/eventedit/...` links.
- Added the Claimed Leads **Book meeting** action in `dmedesk-prospector/docs/app.js`.
- Documented Google Calendar secrets/scopes in `worker/README.md` and `worker/wrangler.toml`.
- Ran Node syntax checks on the changed Apps Script, Worker, repository, calendar service, and frontend files.
- Ran absolute-path clasp status and push; clasp reported `Pushed 4 files` to the configured script ID.

### Database / System Result

No database schema or production data changed. No Supabase SQL was executed. Apps Script deployment uploaded four files: `src/appsscript.json`, `src/code.js`, `src/sasa.js`, and `src/sss.js`.

### Safety Status

No destructive commands were run. No spreadsheet rows or calendar events were created by this deployment; booking remains an explicit user action and requires the Worker Google Calendar secrets to be configured.

## 2026-09-22 — Immediate NPI warning on schedule checkbox

### Objective

Warn users immediately when they check the scheduling checkbox without a valid NPI.

### Actions Completed

- Updated `BD MEETINGS 2026/src/code.js` to validate column S when the column Q checkbox is checked.
- Added a warning and automatically reset the checkbox when the NPI is missing or not 10 digits.
- Ran a Node syntax check and `git diff --check`.
- Pushed the updated Apps Script with clasp; clasp reported `Pushed 4 files`.

### Database / System Result

No database, spreadsheet row data, or calendar events were changed by the deployment.

### Safety Status

The invalid checkbox action is rejected before scheduling. No destructive commands or production SQL were executed.

## 2026-09-22 — Qualification checkbox NPI validation

### Objective

Apply the immediate NPI warning to the MEDB, PPO, and SUB qualification checkboxes, not only the scheduling checkbox.

### Actions Completed

- Updated `BD MEETINGS 2026/src/code.js` to validate NPI column S when columns A-C are checked.
- Added a warning and automatically reset the selected qualification checkbox when the NPI is missing or invalid.
- Ran the Apps Script syntax check and pushed the updated Apps Script with clasp.

### Database / System Result

No database, spreadsheet row data, or calendar events changed during deployment.

### Safety Status

Qualification selection is rejected before downstream scheduling/sync actions when the NPI is invalid. No destructive commands or production SQL were executed.

## 2026-09-22 — Expired rescheduled meeting notice

### Objective

Keep a rescheduled lead's movement cell empty with only `Cancelled` available after its meeting time passes, and notify the opener by email.

### Actions Completed

- Updated the fresh BD Meetings comparison version to email the configured opener when an expired `Rescheduled` row is restricted.
- Added a Script Properties idempotency key so the time-driven scan does not repeatedly email the same expired meeting.
- Preserved the prior BD Meetings folder for comparison.
- Ran the Apps Script syntax check and pushed the updated Apps Script with clasp.

### Database / System Result

No database, spreadsheet row data, or calendar events changed during deployment. Email delivery depends on the existing `OPENER_EMAILS` Script Property mapping and installed movement trigger.

### Safety Status

The lead remains in `New Meetings`; only the movement cell is cleared/restricted. No destructive commands or production SQL were executed.

## 2026-09-22 — Restore prematurely cleared Rescheduled statuses

### Objective

Repair rows whose `Rescheduled` status was cleared by the earlier immediate restriction, while retaining the intended expired-meeting restriction.

### Actions Completed

- Added a recovery scan to the fresh BD Meetings version.
- Restored the normal Status dropdown and `Rescheduled` value only for blank `Cancelled`-only cells whose meeting time is future or blank.
- Left rows with a passed meeting time empty and `Cancelled`-only.
- Ran the Apps Script syntax check and pushed the repair with clasp.

### Database / System Result

No database or calendar data changed during deployment. The existing time-driven movement trigger performs the spreadsheet repair after deployment.

### Safety Status

The repair targets only cells carrying the one-option `Cancelled` validation introduced by the prior rule. No destructive commands or production SQL were executed.

## 2026-09-22 — Exclude Prospector connection column from NPI warning

### Objective

Keep column Q reserved for the Sheet ↔ Prospector connection and exclude it from the qualification-checkbox warning.

### Actions Completed

- Updated `BD MEETINGS 2026/src/code.js` so only MEDB/PPO/SUB columns A-C trigger the immediate NPI warning.
- Left column Q behavior unchanged apart from documenting its connection purpose.
- Ran the Apps Script syntax check and pushed the correction with clasp.

### Database / System Result

No database, spreadsheet row data, or calendar events changed.

### Safety Status

The Prospector connection column is no longer blocked by the new validation. No destructive commands or production SQL were executed.

## 2026-09-22 — Restrict rescheduled leads to Cancelled

### Objective

Keep rescheduled leads in `New Meetings` while making `Cancelled` their only permitted next movement.

### Actions Completed

- Added `Cancelled` to the BD Meetings active-sheet allowlist and built-in destination map.
- Applied a single-option data-validation rule to the movement cell when a `Rescheduled` lead is in `New Meetings`.
- Added the same restriction to queued and batch movement paths.
- Ran the Apps Script syntax check and pushed the updated Apps Script with clasp.

### Database / System Result

No database, spreadsheet row data, or calendar events changed during deployment. The user still needs to create the `Cancelled` tab before moving rows there.

### Safety Status

Rescheduled rows remain in `New Meetings`; only their next movement choice is restricted. No destructive commands or production SQL were executed.

## 2026-09-22 — BD meeting validation, booking, and agent-instruction plan

### Objective

Plan the cross-repository changes for protected BD meeting status transitions, required schedule/NPI validation, immediate Google Calendar booking from Prospector, and compact meeting hyperlink labels. Correct copied agent instructions in both repositories.

### Actions Completed

- Inspected `BD MEETINGS 2026/src/code.js` for movement queues, scheduling, calendar matching, rich-text links, and NPI sync.
- Inspected `dmedesk-prospector/worker/`, `docs/`, and existing Google integration/configuration to identify the live API/frontend boundary.
- Added `documentation/planning/bd-meeting-validation-and-booking-plan.md` with implementation phases, assumptions, verification cases, and out-of-scope items.
- Replaced the copied instructions in `BD MEETINGS 2026/agents.md` and `dmedesk-prospector/agents.md` with repository-specific guidance.

### Database / System Result

No application code, database schema, production data, calendar events, or deployed secrets were changed. This milestone produced one planning document and updated two instruction files.

### Safety Status

No destructive commands or production SQL were executed. No spreadsheet rows, Supabase records, claims, or calendar events were modified.

## 2026-10-09 — Saved-search persistence plan

### Objective

Plan a durable replacement for browser-only saved-search storage, which is
lost when browser storage or the deployed frontend context changes.

### Actions Completed

- Confirmed that `docs/app.js` stores named saved searches only in
  `localStorage` under `dmeProspectorSavedSearches`.
- Confirmed the live Worker already has authenticated, per-user Supabase
  persistence patterns suitable for this feature.
- Added `documentation/plans/SAVED_SEARCH_PERSISTENCE_PLAN.md`, covering the
  additive schema, authenticated API, one-time local migration, ownership,
  retention, verification, and rollout.

### Database / System Result

No application code, SQL migration, production database, deployed frontend,
or user search data was changed. The plan proposes a future manual SQL file
(`sql/038_saved_searches.sql`) only.

### Safety Status

No destructive commands, production mutations, or secrets were used. Existing
browser-local saved searches are untouched and cannot be recovered if they
were already cleared before the future migration.
## 2026-10-09 — Prospect call-note claim control

### Objective

Make the note in the Prospect calling drawer visibly saveable by providing a
clear action that claims the prospect and records the typed note.

### Actions Completed

- Replaced the ambiguous “Claim without a result” text link with a primary
  **Enter note & claim** button immediately below the note field.
- Kept the existing claim-then-note persistence flow and `Ctrl+Enter`
  shortcut; only the user-facing affordance and shortcut wording changed.

### Database / System Result

No schema or production-data change was made. The existing authenticated
Worker routes continue to create the claim and append the entered note.

### Safety Status

No destructive command, production mutation, or secret change was performed.
## 2026-10-09 — Supabase free-tier support-services plan

### Objective

Plan complementary free-tier services that preserve Supabase as the durable
source of truth while keeping large files, disposable caches, backups, and
non-production experimentation outside its core 500 MB budget.

### Actions Completed

- Added `documentation/plans/SUPABASE_FREE_TIER_SUPPORT_PLAN.md`.
- Defined Supabase as authoritative; R2 for objects/archives, KV and Redis
  for disposable cache/locks, B2 for independent backups, and Neon only for
  preview/staging or reproducible reporting summaries.
- Added the requested Neon setup/deploy instructions as a deferred, explicit
  runbook—not a production database migration.

### Database / System Result

No Neon project was linked or deployed. No Supabase database, Cloudflare
resource, external account, migration, secret, or production data changed.

### Safety Status

The plan forbids splitting claims, notes, saved searches, or ownership across
free accounts. External service setup remains subject to target review and
separate credentials.
