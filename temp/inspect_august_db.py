import sqlite3

db_path = r"C:\Users\ben.arthur\AppData\Local\Programs\Python\Python313\august.db"
connection = sqlite3.connect("file:" + db_path + "?mode=ro", uri=True)
for name, sql in connection.execute("select name, sql from sqlite_master where type='table'"):
    print(name)
    print(sql)
connection.close()
