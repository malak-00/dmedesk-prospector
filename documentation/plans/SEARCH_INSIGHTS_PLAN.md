# Prospect search: know before you search

Status (2026-10-05): live, and searching DME Desk's own provider table for everyone.
`sql/021` and `sql/022` have been run; `sql/024` (remove scoring) is written and
recommended but the Worker works without it. `NPI_SOURCE = "dmedesk"` is set in
`worker/wrangler.toml` with `keep_vars = true`.

## The problem

Reps had to guess which filter combinations still held leads. Many returned
nothing, or only leads they had already seen, and nothing said why or what to
change. Filters such as a Medicare minimum ran after a page was fetched, so a page
could come back empty even when plenty of matches existed deeper down.

## What exists

| Feature | How it works |
| --- | --- |
| Live availability line | While filters change, the page asks the Worker how many providers match, how many are unclaimed, and how many are **left for you** (unclaimed, minus what you have already been shown for exactly this search). Counts come from one scan that stops at 5,000, so above that all three show as "at least" (`5,000+`). Identical questions are cached for 30 seconds. |
| Empty-search suggestions | When nothing is left, the Worker tries removing each active filter and offers the three that free up the most leads, as one-click buttons. Exclude keywords are never offered (they are a saved personal default). |
| Search progress | The results bar shows how many leads you have worked and how many are left. |
| Quick picks | One-click chips (Active Medicare billers, Phone and owner on file, Updated this year), each with its live count on top of the current state and specialty. Counted in one database call, and only fetched while the "Lead quality and order" section is open. |
| Territory explorer | "Best bets" (the five richest state-and-specialty pairs) plus a shaded grid of unclaimed leads. Clicking fills in the filters. Cached for 10 minutes. |
| Saved searches | Remember how many unclaimed leads they held when saved or last used and show "+N new" or "N claimed". Stored in the browser only. |
| Quality filters | Has a phone, has a decision maker on file, active Medicare biller, minimum Medicare claims, ZIP starts with. Applied in SQL, so counts and pages are exact. |
| Sort | Default order (by NPI, which is fast), most Medicare activity, recently updated, company name A to Z. Applied in the database before paging, so page one is the right page and "Search more" continues down the same list. The three real sorts have to look at every matching provider, so on a small database machine they can take a few seconds when the data is not already in memory. |
| Smart lookup box | One box: 10 digits is an NPI, a formatted phone number finds that business, exactly 5 digits filters to that ZIP, anything else is a company or **owner** name. NPI, phone and name lookups ignore the other filters. |
| Specialty | Its own sortable column in Prospect and a tag in Claimed. |

## Leads are no longer scored (2026-10-05)

The "fit score" only measured how complete a provider's data was (phone 25, complete
address 20, owner on file 30, Medicare claims 25), not how good a lead it was. It
was removed everywhere: the score ring, "High fit" and "Average score" cards, fit
badge, "why this lead" tags, minimum-score filter, "best fit first" sort and the
"High fit" quick pick; `worker/src/lib/scoring.js`; the score in the call-brief
prompt; and `sql/024` removes it from the database functions.

- **Kept on purpose:** `leads.score_value` and `score_percentage` columns and their
  old data (dropping a column cannot be undone). Nothing reads or writes them.
- **Google Sheet export:** the "Score" and "Score %" columns are still written, empty,
  so every column after them keeps its position for anything that reads the sheet by
  position (the BD MEETINGS workbook is outside this repo).
- **A stored-score table (`provider_scores`, ~47 MB) was designed, tested and then
  deleted before it was ever run**, because removing scoring made it unnecessary.
- Old browser tabs and saved searches that still send a score sort or filter are
  tolerated: the database ignores both and falls back to NPI order.

## Switching everyone to DME Desk's own provider table

`NPI_SOURCE = "dmedesk"` in `worker/wrangler.toml` (with `keep_vars = true`, so a
deploy can never delete variables set in the Cloudflare dashboard). Rollback: change
it to `"mirror"` and deploy.

- **Every DME Desk search goes through `search_providers_v2()`** (one function, no
  per-row specialty lookup; the Worker fills in specialty names in one batch). A
  specialty with no code matches nothing, as it did on the mirror.
- **Bookmarks.** A "Search more" bookmark is a position in one source's ordering, so
  a mirror bookmark would skip or repeat leads here. DME Desk searches use their own
  bookmark (the fingerprint gains `src: "dmedesk"`); a rep's first DME Desk search
  starts at the top but still skips everything they had already seen. Their mirror
  bookmarks are never touched, so rolling back loses nothing. Fingerprints of searches
  on the mirror are byte-identical to before.
- **Admin trial switch** (`X-Search-Source`, `worker/src/lib/sourceTrial.js`): still in
  the code for rollbacks; it hides itself once the Worker itself is on DME Desk.

### Findings from the comparison before the switch (2026-10-05)

- Coverage: 100% of the mirror's sampled results are in DME Desk (VA and NY).
- Virginia: DME Desk holds 8,352 active organizations against the mirror's 3,899 (a
  superset; the reason is not established, most likely newer data).
- Speed: on a Supabase **Nano** instance (shared compute, 0.5 GB) the same query took
  4.3 s cold and 0.18 s warm. The plan was correct; the cost was reading wide rows the
  machine cannot keep cached. The default order avoids it (an index scan).
- Still worth doing: spot-check that Virginia providers missing from the mirror are real
  on the public NPI registry; confirm Medicare data freshness (`npi_cms_enrichment`);
  merge the `fixlag` branch's `seen_npis` fix (not yet on `main`).

## Design notes

- **New SQL functions, existing ones untouched where possible.** `sql/021` added the
  insight functions and `search_providers_v2()`; `sql/022` made them cheaper; `sql/024`
  removes scoring. `search_providers()` (sql/018) is no longer called by the Worker.
- **A sorted or filtered search is one query across all chosen states and
  specialties**, because a sort order is meaningless if each state-and-specialty pair
  is sorted separately and then interleaved. An unsorted search keeps the one-query-per-
  pair fan-out.
- **Counts approximate "unclaimed".** They ignore a teammate's identity-group ownership
  (sql/010), so "unclaimed" can read slightly high. The search itself still applies that
  check when it fills a page.
- **Not built:** "has a website" (a website is only found by enrichment after a provider
  is fetched, so it cannot be counted or filtered up front) and a distance radius (the
  provider table has no coordinates; ZIP prefix is the nearest equivalent).

## Layout (2026-10-05)

The search panel scrolls with the page (it used to be sticky and covered the results);
the results bar and table header stick under the app header, and a **Filters** button
jumps back up. "Lead quality and order" is one collapsible section with an "N active"
badge. Filter chips have their own row.

## Tests

- `sql/tests/search_insights.test.mjs`: 44 checks on a throwaway in-memory Postgres
  (021, 022, 024 applied in order): filters, the three sorts, paging that returns every
  provider exactly once in order, lookups, counts, territory, that scoring is gone, and
  that a hostile value stays inert.
- `worker/test/searchFilters.test.js`, `searchFlow.test.js`, `sourceTrial.test.js`:
  request parsing, payloads, suggestions, bookmark fingerprints and the carry-over to
  DME Desk, and whole searches against a stand-in database.

## Ideas not done yet

- Counts inside the State and Specialty dropdowns (grey out options with none).
- Typo-tolerant name search; recent searches per rep.
- A faster "most Medicare activity" sort (it has to look at every match today).
