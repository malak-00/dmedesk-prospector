import csv
import sqlite3
from pathlib import Path

npi = "1346707791"
db = r"C:\Users\ben.arthur\AppData\Local\Programs\Python\Python313\august.db"
c = sqlite3.connect("file:" + db + "?mode=ro", uri=True)
row = c.execute(
    '''select "NPI", "Provider_Organization_Name_(Legal_Business_Name)",
    "Provider_Business_Mailing_Address_State_Name",
    "Provider_Business_Mailing_Address_Telephone_Number",
    "Authorized_Official_First_Name", "Authorized_Official_Middle_Name",
    "Authorized_Official_Last_Name", "Authorized_Official_Title_or_Position"
    from nppes where "NPI" = ?''', (npi,)
).fetchone()
c.close()
print("nppes=", repr(row))

root = Path(__file__).resolve().parent
for name in ["bd_meetings_resolved.csv", "bd_meetings_unresolved_by_missing.csv", "bd_meetings_ignored.csv", "bd_meetings_npi_enrichment_next_review.csv"]:
    path = root / name
    with path.open(newline="", encoding="utf-8-sig") as f:
        matches = [r for r in csv.DictReader(f) if r.get("npi") == npi or r.get("candidate_npi") == npi]
    print(name, len(matches), matches[:2])
