import csv
from pathlib import Path

root = Path(__file__).resolve().parent.parent
input_path = root / "temp" / "PIS_TO_RESOLVE_RECHECK.csv"
good_path = root / "temp" / "PIS_ENRICHED_GOOD.csv"
remaining_path = root / "temp" / "PIS_TO_RESOLVE_REMAINING.csv"

with input_path.open(newline="", encoding="utf-8-sig") as f:
    rows = list(csv.DictReader(f))

source_keys = {}
for row in rows:
    key = (row["source_sheet"], row["source_row"])
    source_keys.setdefault(key, []).append(row)

good = [row for row in rows if row["recommendation"] == "Accept candidate"]
remaining = []
for candidate_rows in source_keys.values():
    if any(row["recommendation"] == "Accept candidate" for row in candidate_rows):
        continue
    row = candidate_rows[0]
    remaining.append({
        "source_sheet": row["source_sheet"],
        "source_row": row["source_row"],
        "opener": row["opener"],
        "company_name": row["company_name"],
        "authorized_person": row["authorized_person"],
        "source_phone": row["source_phone"],
        "email": row["email"],
        "candidate_count": row["candidate_count"],
        "review_status": "; ".join(sorted(set(r["recommendation"] for r in candidate_rows))),
        "reviewer_notes": "",
    })

good_fields = list(good[0].keys()) if good else []
remaining_fields = ["source_sheet", "source_row", "opener", "company_name", "authorized_person", "source_phone", "email", "candidate_count", "review_status", "reviewer_notes"]
with good_path.open("w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=good_fields)
    writer.writeheader()
    writer.writerows(good)
with remaining_path.open("w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=remaining_fields)
    writer.writeheader()
    writer.writerows(remaining)

print(f"good_rows={len(good)} remaining_source_leads={len(remaining)}")
