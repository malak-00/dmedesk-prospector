import csv
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INPUT = ROOT / "npi_records_rows.csv"
AUDIT = ROOT / "npi_records_strict_duplicate_audit.csv"
GROUPS = ROOT / "npi_records_strict_duplicate_groups.csv"

def text_key(value):
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())

def first_phone(value):
    digits = re.sub(r"\D", "", value or "")
    match = re.search(r"(?:^1)?([0-9]{10})", digits)
    return match.group(1) if match else ""

with INPUT.open(newline="", encoding="utf-8-sig") as handle:
    reader = csv.DictReader(handle)
    rows = list(reader)
    source_fields = reader.fieldnames or []

for row in rows:
    row["_company_key"] = text_key(row.get("name"))
    row["_state_key"] = text_key(row.get("address_state"))
    row["_official_key"] = text_key(" ".join(filter(None, [
        row.get("authorizedofficial_firstname"),
        row.get("authorizedofficial_lastname"),
    ])))
    row["_phone_key"] = first_phone(row.get("phone")) or first_phone(row.get("authorizedofficial_phone"))

groups = defaultdict(list)
for index, row in enumerate(rows):
    key = (row["_company_key"], row["_state_key"], row["_official_key"], row["_phone_key"])
    if all(key):
        groups[key].append(index)
duplicate_groups = {key: indexes for key, indexes in groups.items() if len(indexes) > 1}
duplicate_indexes = {index for indexes in duplicate_groups.values() for index in indexes}

audit_fields = source_fields + [
    "strict_duplicate_flag", "strict_duplicate_group_key", "company_key",
    "state_key", "authorized_official_key", "phone_key",
]
with AUDIT.open("w", newline="", encoding="utf-8-sig") as handle:
    writer = csv.DictWriter(handle, fieldnames=audit_fields)
    writer.writeheader()
    for index, row in enumerate(rows):
        key = (row["_company_key"], row["_state_key"], row["_official_key"], row["_phone_key"])
        out = {field: row.get(field, "") for field in source_fields}
        out.update({
            "strict_duplicate_flag": "TRUE" if index in duplicate_indexes else "FALSE",
            "strict_duplicate_group_key": "|".join(key) if index in duplicate_indexes else "",
            "company_key": row["_company_key"],
            "state_key": row["_state_key"],
            "authorized_official_key": row["_official_key"],
            "phone_key": row["_phone_key"],
        })
        writer.writerow(out)

group_fields = ["duplicate_type", "company_key", "state_key", "authorized_official_key", "phone_key", "record_count", "npis", "record_indexes"]
with GROUPS.open("w", newline="", encoding="utf-8-sig") as handle:
    writer = csv.DictWriter(handle, fieldnames=group_fields)
    writer.writeheader()
    for (company, state, official, phone), indexes in sorted(duplicate_groups.items()):
        writer.writerow({
            "duplicate_type": "same_name_state_authorized_official_phone",
            "company_key": company,
            "state_key": state,
            "authorized_official_key": official,
            "phone_key": phone,
            "record_count": len(indexes),
            "npis": "; ".join(rows[i].get("npi", "") for i in indexes),
            "record_indexes": "; ".join(str(i + 2) for i in indexes),
        })

print(f"source_rows={len(rows)}")
print(f"strict_duplicate_rows={len(duplicate_indexes)}")
print(f"strict_duplicate_groups={len(duplicate_groups)}")
print(f"wrote={AUDIT.name}")
print(f"wrote={GROUPS.name}")
