# Findings

- The dmedesk-prospector app deduplicates repeated NPIs during search and groups search branches using official/company identity keys, but it does not automatically reconcile meeting owner versus existing claim owner.
- The fakeNPI `npi_records` table should retain all NPIs; grouping should be advisory rather than destructive deduplication.
- Strict identity grouping is: normalized company name + state + authorized official + first normalized 10-digit phone.
- The current NPI export contains 190,526 rows.
- Broad grouping produced many possible matches; strict grouping produced 11,684 flagged rows in 4,695 groups.
