import sqlite3

p = r"C:\Users\ben.arthur\AppData\Local\Programs\Python\Python313\august.db"
c = sqlite3.connect("file:" + p + "?mode=ro", uri=True)
sql = '''select "NPI", "Provider_Organization_Name_(Legal_Business_Name)",
"Provider_Business_Mailing_Address_State_Name", "Provider_Business_Mailing_Address_Telephone_Number",
"Authorized_Official_First_Name", "Authorized_Official_Middle_Name", "Authorized_Official_Last_Name"
from nppes where upper("Provider_Organization_Name_(Legal_Business_Name)") like ?'''
print(c.execute(sql, ("%MED SUPPLIES EXPRESS%",)).fetchall())
c.close()
