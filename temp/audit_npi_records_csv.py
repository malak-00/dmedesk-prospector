import csv
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INPUT = ROOT / "npi_records_rows.csv"
AUDIT = ROOT / "npi_records_audit.csv"
GROUPS = ROOT / "npi_records_duplicate_groups.csv"


def normalize_text(value):
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def first_phone(value):
    # Keep the first 10-digit phone from cells containing labels, punctuation,
    # extensions, or multiple phone numbers. Leading country code 1 is removed.
    digits = re.sub(r"\D", "", value or "")
    match = re.search(r"(?:^1)?([0-9]{10})", digits)
    return match.group(1) if match else ""


with INPUT.open(newline="", encoding="utf-8-sig") as handle:
    reader = csv.DictReader(handle)
    rows = list(reader)
    source_fields = reader.fieldnames or []

for row in rows:
    row["_company_key"] = normalize_text(row.get("name"))
    row["_state_key"] = normalize_text(row.get("address_state"))
    row["_phone_key"] = first_phone(row.get("phone"))
    row["_authorized_phone_key"] = first_phone(row.get("authorizedofficial_phone"))

groups = defaultdict(list)
for index, row in enumerate(rows):
    if row.get("npi"):
        groups[("duplicate_npi", row["npi"])].append(index)
    if row["_company_key"] and row["_state_key"]:
        groups[("duplicate_company_state", row["_company_key"] + "|" + row["_state_key"])].append(index)
    if row["_phone_key"] and row["_state_key"]:
        groups[("duplicate_state_phone", row["_state_key"] + "|" + row["_phone_key"])].append(index)
    if row["_authorized_phone_key"] and row["_state_key"]:
        groups[("duplicate_state_authorized_phone", row["_state_key"] + "|" + row["_authorized_phone_key"])].append(index)

duplicate_groups = {key: indexes for key, indexes in groups.items() if len(indexes) > 1}
reasons_by_row = defaultdict(list)
for (reason, key), indexes in duplicate_groups.items():
    for index in indexes:
        reasons_by_row[index].append(reason)

audit_fields = source_fields + ["duplicate_flag", "duplicate_reasons", "company_key", "state_key", "phone_key", "authorized_phone_key"]
with AUDIT.open("w", newline="", encoding="utf-8-sig") as handle:
    writer = csv.DictWriter(handle, fieldnames=audit_fields)
    writer.writeheader()
    for index, row in enumerate(rows):
        out = {field: row.get(field, "") for field in source_fields}
        reasons = sorted(set(reasons_by_row.get(index, [])))
        out.update({
            "duplicate_flag": "TRUE" if reasons else "FALSE",
            "duplicate_reasons": "; ".join(reasons),
            "company_key": row["_company_key"],
            "state_key": row["_state_key"],
            "phone_key": row["_phone_key"],
            "authorized_phone_key": row["_authorized_phone_key"],
        })
        writer.writerow(out)

group_fields = ["duplicate_type", "duplicate_key", "record_count", "npis", "companies", "states", "record_indexes"]
with GROUPS.open("w", newline="", encoding="utf-8-sig") as handle:
    writer = csv.DictWriter(handle, fieldnames=group_fields)
    writer.writeheader()
    for (reason, key), indexes in sorted(duplicate_groups.items()):
        writer.writerow({
            "duplicate_type": reason,
            "duplicate_key": key,
            "record_count": len(indexes),
            "npis": "; ".join(rows[i].get("npi", "") for i in indexes),
            "companies": "; ".join(rows[i].get("name", "") for i in indexes),
            "states": "; ".join(rows[i].get("address_state", "") for i in indexes),
            "record_indexes": "; ".join(str(i + 2) for i in indexes),
        })

print(f"source_rows={len(rows)}")
print(f"duplicate_rows={sum(bool(reasons_by_row.get(i)) for i in range(len(rows)))}")
print(f"duplicate_groups={len(duplicate_groups)}")
print(f"wrote={AUDIT.name}")
print(f"wrote={GROUPS.name}")
