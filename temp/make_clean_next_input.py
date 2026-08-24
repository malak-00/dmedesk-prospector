import csv
from pathlib import Path

root = Path(__file__).resolve().parent
source_path = root / "bd_meetings_npi_enrichment_next_review.csv"
output_path = root / "bd_meetings_npi_manual_review_next_input.csv"

with source_path.open(newline="", encoding="utf-8-sig") as f:
    rows = list(csv.DictReader(f))

groups = {}
for row in rows:
    key = (row["source_sheet"], row["source_row"])
    groups.setdefault(key, []).append(row)

fields = [
    "source_sheet", "source_row", "sub", "opener", "company_name",
    "authorized_person", "phone", "email", "workbook_status",
    "enrichment_result", "candidate_count", "reviewer_notes",
]
clean = []
for candidates in groups.values():
    if any(row["recommendation"] == "Accept candidate" for row in candidates):
        continue
    first = candidates[0]
    clean.append({
        "source_sheet": first["source_sheet"],
        "source_row": first["source_row"],
        "sub": first["sub"],
        "opener": first["opener"],
        "company_name": first["company_name"],
        "authorized_person": first["authorized_person"],
        "phone": first["phone"],
        "email": first["email"],
        "workbook_status": first["workbook_status"],
        "enrichment_result": "; ".join(sorted(set(row["recommendation"] for row in candidates))),
        "candidate_count": first["candidate_count"],
        "reviewer_notes": "",
    })

with output_path.open("w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    writer.writerows(clean)

print(f"clean_manual_review_rows={len(clean)}")
