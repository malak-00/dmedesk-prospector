import csv
import re
import sqlite3
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = r"C:\Users\ben.arthur\AppData\Local\Programs\Python\Python313\august.db"
PIS = ROOT / "PIS_TO_RESOLVE.csv"
SOURCE = ROOT / "temp" / "bd_meetings_npi_enrichment_input_66.csv"
OUTPUT = ROOT / "temp" / "PIS_TO_RESOLVE_RECHECK.csv"

def key(value):
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())

def phone(value):
    raw = str(value or "").strip()
    try:
        if "E" in raw.upper():
            raw = format(Decimal(raw), "f")
    except InvalidOperation:
        pass
    digits = re.sub(r"\D", "", raw)
    return digits[-10:] if len(digits) >= 10 else ""

def person_parts(value):
    return [p for p in re.findall(r"[A-Z]+", (value or "").upper()) if p not in {"MR", "MRS", "MS", "DR", "CEO", "OWNER", "MANAGER", "OFFICE"}]

with PIS.open(newline="", encoding="utf-8-sig") as f:
    pis_rows = list(csv.DictReader(f))
with SOURCE.open(newline="", encoding="utf-8-sig") as f:
    source_rows = list(csv.DictReader(f))
source_by_key = {(r.get("source_sheet"), r.get("source_row")): r for r in source_rows}

conn = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
columns = [
    "NPI", "Provider_Organization_Name_(Legal_Business_Name)",
    "Provider_Business_Mailing_Address_State_Name", "Provider_Business_Mailing_Address_Telephone_Number",
    "Provider_Business_Practice_Location_State_Name", "Provider_Business_Practice_Location_Telephone_Number",
    "Provider_First_Line_Business_Practice_Location_Address", "Provider_Second_Line_Business_Practice_Location_Address",
    "Provider_Business_Practice_Location_Address_City_Name", "Provider_Business_Practice_Location_Address_Postal_Code",
    "Authorized_Official_First_Name", "Authorized_Official_Middle_Name", "Authorized_Official_Last_Name",
    "Authorized_Official_Telephone_Number", "Authorized_Official_Title_or_Position", "Last_Update_Date",
]
quoted = ", ".join('"' + c.replace('"', '""') + '"' for c in columns)
records = [dict(zip(columns, row)) for row in conn.execute(f"select {quoted} from nppes")]
conn.close()
by_name = {}
for record in records:
    by_name.setdefault(key(record[columns[1]]), []).append(record)

fields = [
    "review_id", "source_sheet", "source_row", "opener", "company_name", "authorized_person",
    "source_phone", "email", "candidate_count", "candidate_rank", "candidate_npi",
    "candidate_legal_name", "candidate_state", "candidate_phone", "candidate_authorized_person",
    "candidate_auth_phone", "candidate_title", "exact_name", "phone_match",
    "authorized_person_match", "recommendation", "notes",
]
out = []
for index, row in enumerate(pis_rows, start=1):
    source = source_by_key.get((row.get("source_sheet"), row.get("source_row")), {})
    source_phone = source.get("phone") or row.get("phone")
    candidates = by_name.get(key(row.get("company_name")), [])
    if not candidates:
        out.append({
            "review_id": str(index), "source_sheet": row.get("source_sheet", ""), "source_row": row.get("source_row", ""),
            "opener": row.get("opener", ""), "company_name": row.get("company_name", ""), "authorized_person": row.get("authorized_person", ""),
            "source_phone": source_phone, "email": row.get("email", ""), "candidate_count": "0", "candidate_rank": "",
            "candidate_npi": "", "candidate_legal_name": "", "candidate_state": "", "candidate_phone": "", "candidate_authorized_person": "",
            "candidate_auth_phone": "", "candidate_title": "", "exact_name": "FALSE", "phone_match": "FALSE",
            "authorized_person_match": "FALSE", "recommendation": "Manual review - no exact legal-name match", "notes": "",
        })
        continue
    source_person = person_parts(row.get("authorized_person"))
    for rank, candidate in enumerate(candidates, start=1):
        official = " ".join(filter(None, [candidate.get("Authorized_Official_First_Name"), candidate.get("Authorized_Official_Middle_Name"), candidate.get("Authorized_Official_Last_Name")]))
        official_parts = person_parts(official)
        source_phone_key = phone(source_phone)
        candidate_phone_value = candidate.get("Provider_Business_Practice_Location_Telephone_Number")
        if candidate_phone_value == "Provider_Business_Practice_Location_Telephone_Number":
            candidate_phone_value = candidate.get("Provider_Business_Mailing_Address_Telephone_Number")
        candidate_phone_key = phone(candidate_phone_value)
        auth_phone_key = phone(candidate.get("Authorized_Official_Telephone_Number"))
        phone_match = bool(source_phone_key and (source_phone_key == candidate_phone_key or source_phone_key == auth_phone_key))
        last_match = bool(source_person and official_parts and source_person[-1] == official_parts[-1])
        first_match = bool(source_person and official_parts and source_person[0] == official_parts[0])
        authorized_match = last_match and (first_match or len(source_person[0]) == 1 or len(official_parts[0]) == 1)
        accept = phone_match or authorized_match
        out.append({
            "review_id": f"{index}.{rank}", "source_sheet": row.get("source_sheet", ""), "source_row": row.get("source_row", ""),
            "opener": row.get("opener", ""), "company_name": row.get("company_name", ""), "authorized_person": row.get("authorized_person", ""),
            "source_phone": source_phone, "email": row.get("email", ""), "candidate_count": str(len(candidates)), "candidate_rank": str(rank),
            "candidate_npi": candidate.get("NPI", ""), "candidate_legal_name": candidate.get(columns[1], ""),
            "candidate_state": candidate.get("Provider_Business_Mailing_Address_State_Name", ""), "candidate_phone": candidate_phone_value or "",
            "candidate_authorized_person": official, "candidate_auth_phone": candidate.get("Authorized_Official_Telephone_Number", ""),
            "candidate_title": candidate.get("Authorized_Official_Title_or_Position", ""), "exact_name": "TRUE", "phone_match": "TRUE" if phone_match else "FALSE",
            "authorized_person_match": "TRUE" if authorized_match else "FALSE",
            "recommendation": "Accept candidate" if accept else "Manual review - corroboration missing",
            "notes": "Phone matched after scientific-notation repair" if phone_match and "E" in str(source_phone).upper() else "",
        })

with OUTPUT.open("w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    writer.writerows(out)

print(f"source_leads={len(pis_rows)} candidate_rows={len(out)} accepted_rows={sum(r['recommendation'] == 'Accept candidate' for r in out)} manual_rows={sum(r['recommendation'].startswith('Manual') for r in out)}")
