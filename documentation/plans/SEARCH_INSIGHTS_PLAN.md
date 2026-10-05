# Smarter search: know before you search

Status: **live for admins only (trial).** `sql/021` was run by the project owner,
the Worker (version `b14c364c`) is deployed, and the frontend is pushed. Searches
must read from DME Desk's own provider table; for everyone except trial admins the
Worker is still on the mirror (`NPI_SOURCE` is not set), so the new controls stay
hidden and search behaves exactly as before.

## Admin trial of DME Desk search

An admin sees a **Search source** button in the Prospect filter bar. It is on by
default for admins and remembered per browser; one click returns to the current
source. When on, the browser sends `X-Search-Source: dmedesk`; the Worker honours
it only for an admin session (`worker/src/lib/sourceTrial.js`, unit tested,
including that a non-admin's header is ignored) and only for that request.
Nobody else is affected and nothing is stored on the server. Trial searches keep
their own paging bookmarks, so they never disturb a rep's mirror bookmarks.

## Layout and speed follow-up (2026-10-05)

- The search panel is no longer sticky. A tall form covered the results table,
  and the table header jumped whenever the panel changed height. The results bar
  and table header still stick under the app header, and the results bar has a
  **Filters** button that scrolls back up to the panel. The sticky-offset code
  only counts the panel's height if it is actually sticky.
- Lead quality, sort order and quick picks live in one collapsible section
  (closed by default, with an "N active" badge). Quick picks are only fetched
  when it is open, and only re-counted when the state or specialty changes.
- The admin source switch moved to the app header; filter chips have their own
  row and disappear when there are none.
- Territory: "Best bets" cards (the five richest state-and-specialty pairs), a
  state filter, a legend, and a sticky-header grid.
- `sql/022_search_speed.sql` (optional, not yet run): single-pass counts, a
  one-call quick-picks count, and no per-row specialty-name lookup in the sorted
  search. Counts above 5,000 matches are lower bounds and are shown with a "+".
  The Worker caches identical count questions for 30 seconds.

## Stored fit scores (sql/023, 2026-10-05)

Measured on the live database (Supabase Nano: shared compute, 0.5 GB memory): the
query behind "best fit first" for Virginia took 4.3 s cold and 0.18 s warm, with
a correct plan both times (index scan, primary-key join to the Medicare table,
top-N sort, JIT off). The cost was reading and scoring all ~8,400 wide
`npi_records` rows (183 MB table) on every search, which a small machine cannot
keep cached.

`sql/023_provider_scores.sql` adds a narrow `provider_scores` table (one row per
active organization: state, city, specialty, ZIP, update year, has-phone,
has-decision-maker, Medicare claims, and the score) with indexes ordered by
score, so the top 200 is read straight from the index.

- **Correctness first.** The stored rows are used only when the table is fresh,
  was built with the same weights, the sort is "score", and the filters are ones
  the table answers exactly (states, city, specialty, update years, ZIP, minimum
  score, has phone, has decision maker, active Medicare, minimum claims).
  Company-name text, exclude keywords, owner/phone/NPI lookups, inactive or
  individual providers and other sorts use the live path as before.
- **Same SQL, same answer.** The build uses the live search's own score
  expression. `sql/tests/023_provider_scores.test.mjs` compares the two paths on
  3,000 random providers across about 100 filter and page combinations and
  requires identical results in identical order (151 checks).
- **Stale never served.** Statement-level triggers on `npi_records` and
  `npi_cms_enrichment` mark the table stale (at most once a second). A rebuild
  that overlaps a data change stays stale.
- **Plan detail.** A single state or specialty is written as `=`, not
  `= any(array)`: only the plain form lets Postgres read the score index in
  order and stop after the first page.
- **To keep it fresh:** `select public.refresh_provider_scores();` after every
  monthly data load (not yet wired into `scripts/nppes_ingest`). Until then
  searches silently use the live path. The app shows the state in the tooltip of
  the admin "Search source" button.
- Weights live in `worker/src/lib/scoring.js`; a Worker test fails if the SQL
  defaults ever drift from them.

## Findings from the first comparison (2026-10-05)

- Coverage: 100% of the mirror's sampled results are in DME Desk (VA and NY).
- Virginia: DME Desk holds 8,352 active organizations against the mirror's 3,899
  (8,559 before the active/organization filters). DME Desk is a superset; the
  reason is not yet established (most likely newer data than the mirror).
- Speed: a 200-row Virginia page took about 1.8 s in the SQL editor, and the
  comparison page 2.4 to 2.9 s against the mirror's 0.3 to 0.6 s. Open until the
  one-time `vacuum (analyze) public.npi_records` (sql/018) is confirmed and the
  page is re-timed warm.
- The name index `idx_npi_records_name_trgm` exists.

Still to settle before setting `NPI_SOURCE=dmedesk` for everyone: speed, the
reason for the Virginia difference, Medicare data freshness, the open "Search more
repetition" audit (the `fixlag` branch has a `seen_npis` fix not yet on `main`),
and what to do with rep bookmarks, which count positions in the mirror's order.

## The problem

Reps had to guess which filter combinations still held leads. Many returned
nothing, or only leads they had already seen, and nothing said why or what to
change. Minimum-Medicare and similar filters ran after a page was fetched, so a
page could come back empty even when plenty of matches existed deeper down.

## What was built

| Feature | How it works |
| --- | --- |
| Live availability line | While filters change, the page asks the Worker how many providers match, how many are unclaimed, and how many are **left for you** (unclaimed, minus what you have already been shown for exactly this search). Counts stop at 5,000 and show as `5,000+`. |
| Empty-search suggestions | When nothing is left, the Worker tries removing each active filter and offers the three that free up the most leads, each as a one-click button. Exclude keywords are never offered (they are a saved personal default). |
| Search progress | The results bar shows how many leads you have worked and how many are left for the current filters. |
| Quick picks | One-click chips (High fit 75%+, Active Medicare billers, Phone and owner on file, Updated this year), each with its live count on top of the current state and specialty. Click again to remove. |
| Territory explorer | A grid of unclaimed leads by state and specialty, shaded by count. Clicking a cell fills in the filters. Cached for 10 minutes. |
| Saved searches | Remember how many unclaimed leads they held when saved or last used, and show "+N new" or "N claimed" when the menu opens. Stored in the browser only. |
| Quality filters | Minimum fit score, has a phone, has a decision maker on file, active Medicare biller, ZIP starts with. Applied in SQL, so counts and pages are exact. |
| Sort before paging | Best fit first (default), most Medicare activity, recently updated, A to Z, or original order. The order is applied in the database before paging, so page one is the best page and "Search more" continues down the same list. |
| Smart lookup box | One box: 10 digits is an NPI, a formatted phone number finds that business, exactly 5 digits filters to that ZIP, anything else is a company or **owner** name. NPI, phone and name lookups ignore the other filters. |

## Design decisions

- **New SQL functions, existing ones untouched.** `search_providers()` (sql/018)
  still answers every search that uses none of the new options. Only
  `search_providers_v2()` knows the new filters and sorting. Nothing that works
  today can change by running 021.
- **The fit score is computed in SQL from the same four facts as
  `worker/src/lib/scoring.js`** (phone, complete address, authorized official,
  Medicare claims). The Worker sends its own weights with every request, so they
  live in one place. If the scoring rules ever gain a factor the database cannot
  see (a website, a rating), the SQL must be extended too.
- **A sorted or filtered search is one query across all chosen states and
  specialties** (collapsed), because a sort order is meaningless if each
  state-and-specialty pair is sorted separately and then interleaved. Unsorted,
  unfiltered searches keep the original one-query-per-pair fan-out.
- **Saved search progress is preserved.** The bookmark fingerprint gains the new
  options only when they are set, so every search made before keeps exactly the
  fingerprint it had (checked byte-for-byte against the previous version).
- **Counts are an approximation of "unclaimed".** They ignore a teammate's
  identity-group ownership (sql/010), so "unclaimed" can read slightly high.
  The search itself still applies that check when it fills a page.
- **Not built:** "has a website" (a website is only found by enrichment after a
  provider is fetched, so it cannot be counted or filtered up front), and a
  distance radius (the provider table has no coordinates; ZIP prefix is the
  nearest equivalent).

## Order of deployment (manual)

1. Review and run `sql/021_search_insights.sql` in the Supabase project the
   Worker uses. It is read-only and rerun-safe. Verification queries are at the
   end of the file.
2. Make sure `NPI_SOURCE` is `dmedesk` (Cloudflare dashboard). `GET
   /search/capabilities` reports `{ advanced: true }` when everything is in place.
3. Deploy the Worker.
4. Push the frontend.

## Tests

- `sql/tests/021_search_insights.test.mjs`: 35 checks on a throwaway in-memory
  Postgres (counts, filters, sorting before paging, lookups, injection).
- `worker/test/searchFilters.test.js` and `worker/test/searchFlow.test.js`:
  request parsing, payloads, suggestions, progress fingerprints, and whole
  searches against a stand-in database.

## Ideas not done yet

- Counts inside the State and Specialty dropdowns (grey out options with none).
- Typo-tolerant name search.
- Recent searches per rep.
- "Has website" and radius, if the provider table gains that data.
