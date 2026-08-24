import csv
from pathlib import Path

root = Path(__file__).resolve().parent
unresolved_path = root / "bd_meetings_unresolved_by_missing.csv"
pilot_path = root / "bd_meetings_npi_pilot_10_august_results.csv"
output_path = root / "bd_meetings_unresolved_review_queue.csv"

with unresolved_path.open(newline="", encoding="utf-8-sig") as f:
    unresolved = list(csv.DictReader(f))

with pilot_path.open(newline="", encoding="utf-8-sig") as f:
    pilot = list(csv.DictReader(f))

pilot_by_key = {}
for row in pilot:
    key = (row.get("source_sheet", ""), row.get("source_row", ""))
    pilot_by_key.setdefault(key, []).append(row)

base_fields = [
    "review_id", "source_sheet", "source_row", "sub", "opener", "company_name",
    "authorized_person", "phone", "email", "workbook_status", "resolution",
    "claimed_by", "duplicate_locations",
]
decision_fields = [
    "exclude_checkbox", "exclude_reason", "enrich_checkbox",
    "candidate_npi", "candidate_legal_name", "candidate_state",
    "candidate_phone", "candidate_authorized_person", "candidate_title",
    "exact_legal_name_checkbox", "phone_match_checkbox",
    "authorized_person_match_checkbox", "candidate_accept_checkbox",
    "supabase_preflight_checkbox", "supabase_existing_owner",
    "owner_decision_checkbox", "final_import_checkbox", "reviewer_notes",
]

rows = []
for index, source in enumerate(unresolved, start=1):
    key = (source.get("source_sheet", ""), source.get("source_row", ""))
    candidates = pilot_by_key.get(key) or [{}]
    for candidate_index, candidate in enumerate(candidates, start=1):
        row = {field: source.get(field, "") for field in base_fields if field != "review_id"}
        row["review_id"] = f"{index}.{candidate_index}"
        row.update({field: "" for field in decision_fields})
        row["exclude_checkbox"] = "☐"
        row["enrich_checkbox"] = "☐"
        row["candidate_npi"] = candidate.get("candidate_npi", "")
        row["candidate_legal_name"] = candidate.get("candidate_legal_name", "")
        row["candidate_state"] = candidate.get("candidate_state", "")
        row["candidate_phone"] = candidate.get("candidate_practice_phone", "")
        row["candidate_authorized_person"] = candidate.get("candidate_authorized_official", "")
        row["candidate_title"] = candidate.get("candidate_title", "")
        row["exact_legal_name_checkbox"] = "☑" if candidate.get("exact_legal_name") == "True" else "☐"
        row["phone_match_checkbox"] = "☑" if candidate.get("phone_match") == "True" else "☐"
        row["authorized_person_match_checkbox"] = "☑" if candidate.get("authorized_person_match") == "True" else "☐"
        rows.append(row)

with output_path.open("w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=base_fields + decision_fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)

print(f"Wrote {len(rows)} review rows for {len(unresolved)} unresolved source rows to {output_path.name}")
