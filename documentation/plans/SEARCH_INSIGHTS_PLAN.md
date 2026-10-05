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
