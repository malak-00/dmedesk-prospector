# BD MEETINGS → claim leads for a teammate

`POST /admin/claim-for-user` lets BD MEETINGS claim leads in DME Desk for
the opener of a meeting, without that person's password. BD MEETINGS signs
in with **its own integration account**, never an admin's or a teammate's.

## One-time setup

1. Run `sql/011_claim_for_user.sql` in the Supabase SQL Editor (after `010`).
2. Deploy the Worker (`npm run deploy` in `worker/`).
3. Create the integration account from `worker/`, with a long random password:

   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
     node scripts/seed-user.mjs --username bd-meetings-bot --password "<long random>" \
       --displayName "BD Meetings (integration)" --can-claim-for-others
   ```

   The account is **not** an admin. Its only extra permission is
   `app_users.can_claim_for_others`.
4. Store the password only in BD MEETINGS' private script settings (e.g.
   Apps Script Script Properties) — never in a sheet cell or in the repo.

**Revoking:** `update public.app_users set can_claim_for_others = false where username = 'bd-meetings-bot';`
takes effect on the next request (the permission is read from the database
each time). Changing the account's password stops new logins; an existing
session token stays valid until it expires (6 hours).

## Per run

```text
POST /auth/login
  { "username": "bd-meetings-bot", "password": "<from script settings>" }
  -> { data: { token } }

POST /admin/claim-for-user          Authorization: Bearer <token>
  {
    "username": "jimmy.pearson.wiz@gmail.com",
    "companies": [
      {
        "npi": "1234567893",
        "name": "ABC Medical Supply LLC",
        "state": "VA",
        "city": "Richmond",
        "addressLine1": "1 Main St",
        "postalCode": "23219",
        "phone": "(555) 123-4567",
        "authorizedOfficial": "Jane Smith",
        "authorizedOfficialTitle": "Owner",
        "authorizedOfficialPhone": "(555) 123-4567"
      }
    ]
  }
```

- `username` must be the teammate's **exact** DME Desk username (case doesn't
  matter). BD MEETINGS needs a fixed opener → username mapping, e.g.
  `Jimmy → jimmy.pearson.wiz@gmail.com`. Openers without a DME Desk account
  (e.g. Jane, George, Russ) are refused with 404 — never guessed.
- One `username` per request; up to **200** companies.
- `npi` is required (10 digits). Rows without one come back in `invalid`.
- `authorizedOfficial` must be the NPPES **authorized official**, not just any
  contact — it is used to decide which leads belong to the same business.
  When the NPI is in DME Desk's `npi_records`, that record's identity is used
  instead.
- Only `npi` is strictly required; the other fields fill in the lead.

## Response

```json
{
  "success": true,
  "data": {
    "rowsAdded": 1,
    "claimedBy": "Jimmy Pearson",
    "claimedFor": { "username": "jimmy.pearson.wiz@gmail.com", "displayName": "Jimmy Pearson" },
    "claimedVia": "bd-meetings-bot",
    "claimedNpis": ["1234567893"],
    "alreadyClaimedNpis": [],
    "blocked": [{ "npi": "...", "companyName": "...", "groupName": "...", "owners": ["Nora Atkins"] }],
    "heldForReview": [{ "npi": "...", "companyName": "...", "matches": [{ "npi": "...", "companyName": "...", "tier": 2, "matchedKeys": ["state", "official", "phone"], "ownerName": "Nora Atkins" }] }],
    "invalid": [{ "npi": "NO-NPI", "reason": "invalid_npi" }]
  }
}
```

Same rules as claiming in the app:

| Result | Meaning | Suggested write-back |
|---|---|---|
| `claimedNpis` | Claimed for the teammate | "Claimed in DME Desk" |
| `alreadyClaimedNpis` | The teammate already had it | "Already theirs" |
| `blocked` | Someone else owns this business | "Owned by <owners>" |
| `heldForReview` | Possible duplicate of someone else's lead; an admin decides under Possible duplicates | "Held for admin review" — retry after the decision |
| `invalid` | Missing/invalid NPI or duplicate row in the request | "Needs NPI" |

Errors: `400` bad request (no username, no companies, more than 200), `401`
not signed in, `403` account not allowed to claim for others, `404` no user
with that username, `503` `sql/011` not installed yet.

## Audit trail

Each claim writes a `claimed` event in `lead_ownership_events` with
`to_user_id` = the teammate, `source = 'claim_for_user'`,
`approved_by` = the integration account, and `metadata.actor_user_id`.
Held requests record the teammate as `requested_by` and the integration
account in `snapshot.requestedVia`.
