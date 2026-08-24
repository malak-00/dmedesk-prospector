import sqlite3

p = r"C:\Users\ben.arthur\AppData\Local\Programs\Python\Python313\august.db"
c = sqlite3.connect("file:" + p + "?mode=ro", uri=True)
names = [
    "NPI",
    "Provider_Organization_Name_(Legal_Business_Name)",
    "Provider_Business_Mailing_Address_State_Name",
    "Provider_Business_Mailing_Address_Telephone_Number",
    "Provider_Business_Practice_Location_State_Name",
    "Provider_Business_Practice_Location_Telephone_Number",
]
sql = "select " + ", ".join('"' + n + '"' for n in names) + " from nppes where \"NPI\" = ?"
print(repr(c.execute(sql, ("1194656504",)).fetchone()))
c.close()
