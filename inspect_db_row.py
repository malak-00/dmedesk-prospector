import sqlite3

p = r"C:\Users\ben.arthur\AppData\Local\Programs\Python\Python313\august.db"
c = sqlite3.connect("file:" + p + "?mode=ro", uri=True)
row = c.execute(
    'select "NPI", "Provider_Business_Practice_Location_State_Name", "Provider_Business_Practice_Location_Telephone_Number" from nppes where "NPI" = ?',
    ("1194656504",),
).fetchone()
print(repr(row))
c.close()
