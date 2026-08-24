import csv
import re
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parent
db_path = r"C:\Users\ben.arthur\AppData\Local\Programs\Python\Python313\august.db"
queue_path = root / "bd_meetings_unresolved_review_queue.csv"
output_path = root / "bd_meetings_npi_enrichment_next_review.csv"

def norm(value):
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())

def phone(value):
    return re.sub(r"\D", "", value or "")[-10:]

def person_tokens(value):
    return set(re.findall(r"[A-Z]+", (value or "").upper()))

with queue_path.open(newline="", encoding="utf-8-sig") as f:
    queue = list(csv.DictReader(f))

# Use one source row per company/meeting row; pilot candidate expansions are not
# used as input because this pass rechecks the full local database consistently.
source_rows = {}
for row in queue:
    if row.get("resolution") != "Unresolved: no verified NPI match":
        continue
    if row.get("exclude_checkbox", "").strip().upper() == "TRUE":
        continue
    if row.get("sub", "").strip().upper() == "SUB":
        continue
    if "ENTOURAGE ME UAE" in (row.get("company_name", "").upper()):
        continue
    key = (row.get("source_sheet", ""), row.get("source_row", ""))
    source_rows[key] = row

connection = sqlite3.connect("file:" + db_path + "?mode=ro", uri=True)
columns = [
    'NPI', 'Provider_Organization_Name_(Legal_Business_Name)',
    'Provider_Business_Practice_Location_State_Name',
    'Provider_Business_Practice_Location_Telephone_Number',
    'Provider_First_Line_Business_Practice_Location_Address',
    'Provider_Second_Line_Business_Practice_Location_Address',
    'Provider_Business_Practice_Location_Address_City_Name',
    'Provider_Business_Practice_Location_Address_Postal_Code',
    'Authorized_Official_Last_Name', 'Authorized_Official_First_Name',
    'Authorized_Official_Middle_Name', 'Authorized_Official_Title_or_Position',
    'Authorized_Official_Telephone_Number', 'Last_Update_Date',
]
quoted = ", ".join('"' + c.replace('"', '""') + '"' for c in columns)
records = connection.execute(f'SELECT {quoted} FROM nppes').fetchall()
connection.close()

by_name = {}
for record in records:
    item = dict(zip(columns, record))
    by_name.setdefault(norm(item[columns[1]]), []).append(item)

fields = [
    "review_id", "source_sheet", "source_row", "sub", "opener", "company_name",
    "authorized_person", "phone", "email", "workbook_status", "candidate_count",
    "candidate_rank", "candidate_npi", "candidate_legal_name", "candidate_state",
    "candidate_practice_phone", "candidate_address", "candidate_authorized_person",
    "candidate_auth_phone", "candidate_title", "candidate_last_update",
    "exact_legal_name", "phone_match", "authorized_person_match",
    "recommendation", "candidate_accept_checkbox", "reviewer_notes",
]
output = []
for index, source in enumerate(source_rows.values(), start=1):
    candidates = by_name.get(norm(source.get("company_name"))) or []
    rows_for_source = []
    for candidate in candidates:
        auth = " ".join(filter(None, [
            candidate.get("Authorized_Official_First_Name"),
            candidate.get("Authorized_Official_Middle_Name"),
            candidate.get("Authorized_Official_Last_Name"),
        ]))
        candidate_phone = phone(candidate.get("Provider_Business_Practice_Location_Telephone_Number"))
        candidate_auth_phone = phone(candidate.get("Authorized_Official_Telephone_Number"))
        source_phone = phone(source.get("phone"))
        source_person = person_tokens(source.get("authorized_person"))
        auth_person = person_tokens(auth)
        auth_match = bool(source_person and auth_person and len(source_person & auth_person) >= 2)
        phone_match = bool(source_phone and (source_phone == candidate_phone or source_phone == candidate_auth_phone))
        accepted = phone_match or auth_match
        address = " ".join(filter(None, [
            candidate.get("Provider_First_Line_Business_Practice_Location_Address"),
            candidate.get("Provider_Second_Line_Business_Practice_Location_Address"),
            candidate.get("Provider_Business_Practice_Location_Address_City_Name"),
            candidate.get("Provider_Business_Practice_Location_Address_State_Name"),
            candidate.get("Provider_Business_Practice_Location_Address_Postal_Code"),
        ]))
        rows_for_source.append({
            "candidate_npi": candidate.get("NPI", ""),
            "candidate_legal_name": candidate.get(columns[1], ""),
            "candidate_state": candidate.get("Provider_Business_Practice_Location_State_Name", ""),
            "candidate_practice_phone": candidate.get("Provider_Business_Practice_Location_Telephone_Number", ""),
            "candidate_address": address,
            "candidate_authorized_person": auth,
            "candidate_auth_phone": candidate.get("Authorized_Official_Telephone_Number", ""),
            "candidate_title": candidate.get("Authorized_Official_Title_or_Position", ""),
            "candidate_last_update": candidate.get("Last_Update_Date", ""),
            "exact_legal_name": "TRUE",
            "phone_match": "TRUE" if phone_match else "FALSE",
            "authorized_person_match": "TRUE" if auth_match else "FALSE",
            "recommendation": "Accept candidate" if accepted else "Manual review - corroboration missing",
        })
    if not rows_for_source:
        rows_for_source = [{
            "candidate_npi": "", "candidate_legal_name": "", "candidate_state": "",
            "candidate_practice_phone": "", "candidate_address": "",
            "candidate_authorized_person": "", "candidate_auth_phone": "",
            "candidate_title": "", "candidate_last_update": "",
            "exact_legal_name": "FALSE", "phone_match": "FALSE",
            "authorized_person_match": "FALSE",
            "recommendation": "Manual review - no exact legal-name match",
        }]
    for rank, candidate in enumerate(rows_for_source, start=1):
        output.append({
            "review_id": f"{index}.{rank}",
            **{field: source.get(field, "") for field in fields if field in source},
            "candidate_count": str(len(candidates)),
            "candidate_rank": str(rank),
            **candidate,
            "candidate_accept_checkbox": "",
            "reviewer_notes": "",
        })

with output_path.open("w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    writer.writerows(output)

accepted = sum(1 for row in output if row["recommendation"] == "Accept candidate")
manual = sum(1 for row in output if row["recommendation"].startswith("Manual review"))
print(f"eligible_source_rows={len(source_rows)} output_rows={len(output)} accepted_candidates={accepted} manual_review_rows={manual}")
