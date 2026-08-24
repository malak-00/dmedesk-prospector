import psycopg2
from pathlib import Path

url = Path("supabase/.temp/pooler-url").read_text(encoding="utf-8").strip()
connection = psycopg2.connect(url)
connection.set_session(readonly=True, autocommit=False)
cursor = connection.cursor()
cursor.execute("""
    select table_schema, table_name
    from information_schema.tables
    where table_schema not in ('pg_catalog', 'information_schema')
    order by table_schema, table_name
""")
for row in cursor.fetchall():
    print(row)
cursor.close()
connection.rollback()
connection.close()
