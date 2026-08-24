import csv
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parent
path = root / "bd_meetings_npi_enrichment_next_review.csv"
db = r"C:\Users\ben.arthur\AppData\Local\Programs\Python\Python313\august.db"

def digits(value):
    return "".join(ch for ch in (value or "") if ch.isdigit())[-10:]

with path.open(newline="", encoding="utf-8-sig") as f:
    rows = list(csv.DictReader(f))

c = sqlite3.connect("file:" + db + "?mode=ro", uri=True)
db_rows = c.execute(
    'select "NPI", "Provider_Business_Mailing_Address_State_Name", "Provider_Business_Mailing_Address_Telephone_Number" from nppes'
).fetchall()
c.close()
by_npi = {row[0]: row for row in db_rows}

for row in rows:
    db_row = by_npi.get(row.get("candidate_npi"))
    if not db_row:
        continue
    row["candidate_state"] = db_row[1] or row.get("candidate_state", "")
    row["candidate_practice_phone"] = db_row[2] or row.get("candidate_practice_phone", "")
    phone_match = bool(digits(row.get("phone")) and digits(row.get("phone")) == digits(db_row[2]))
    row["phone_match"] = "TRUE" if phone_match else "FALSE"
    auth_match = row.get("authorized_person_match") == "TRUE"
    row["recommendation"] = "Accept candidate" if phone_match or auth_match else "Manual review - corroboration missing"

with path.open("w", newline="", encoding="utf-8-sig") as f:
    writer = csv.DictWriter(f, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)

print("repaired candidate state, phone, and recommendations")
