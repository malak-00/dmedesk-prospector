# BD Main → DME Desk migration plan

## Immediate August import

The August CSV is an already-curated historical batch. For now, the import is
one-way and insert-only:

1. Install `sql/008_lead_import_staging.sql` in Supabase.
2. Run the uploader in dry-run mode against the CSV.
3. Review invalid NPIs and duplicates.
4. Run with `--upload`.
5. Verify the staged batch in Supabase.
6. Do not apply it to `public.leads` until the CLI and grouping rules are
   finalized.

```powershell
python scripts/lead-intake/upload_august.py "C:\path\to\august.csv" `
  --batch august-2026 --dry-run

python scripts/lead-intake/upload_august.py "C:\path\to\august.csv" `
  --batch august-2026 --upload
```

The uploader accepts the current exported CSV headers such as `Company Name`,
`NPI`, `Phone`, `Address`, `Specialty`, and `NPPES Last Updated`. It inserts
only into `lead_import_staging`. It never updates, deletes, or upserts live
leads. NPIs already present in `public.leads` are skipped during upload.

## Final target workflow

```text
NPPES August/source CSV
  → normalize
  → deterministic BD Main exclusions
  → duplicate detection
  → identity grouping
  → review ambiguous groups
  → assign rounds and owners
  → apply accepted leads to public.leads
```

## BD Main rules to implement

- Assign leads to an intake round before ownership assignment.
- Deduplicate by normalized company name.
- For the same authorized official, retain the newest NPPES record.
- Run enrichment/search only after initial filtering.
- Preserve the primary record in a three-record duplicate group; mark the
  others as aliases or possible duplicates.
- Exclude the agreed `Dis/WN + Meetings` pattern once its exact meaning is
  confirmed.
- Exclude or review phones appearing more than three times.
- Deduplicate matching phone + authorized official combinations.
- Exclude configured company-name keywords and company names.
- Exclude the configured authorized-official names.

## Data model direction

Rules must be versioned and stored with every import. A lead should have an
auditable result of `accepted`, `excluded`, or `needs_review`, with the rule
name and batch recorded. Historical records should be superseded or excluded,
not physically deleted.

The existing `lead_groups` and `lead_group_members` tables should remain the
source of truth for identity relationships. Ownership and intake round are
separate concepts: a round identifies the batch, while `claimed_by` identifies
the current salesperson.

## Required follow-up work

1. Add a versioned `bd-main-v1` ruleset.
2. Extend `leadPreflight.js` with keyword, official, phone-frequency, and
   company-name checks.
3. Extend grouping to use normalized company, official, phone, state, and
   address signals.
4. Add a review queue for ambiguous groups.
5. Add round-robin assignment at the group level.
6. Build a deliberate staging-to-live apply command with a confirmation flag.
7. Test against a historical BD Main export before enabling automatic apply.

## Decisions still required

- Exact meaning of `MAIN in the 3 dups`.
- Exact matching semantics for `Dis/WN + Meetings`.
- Whether phone numbers used by multiple unrelated businesses should be
  excluded automatically or sent to review.

