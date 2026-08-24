import csv
import os
import sys
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parent
SQL_PATH = ROOT / "supabase_duplicate_audit.sql"
OUTPUT_PATH = ROOT / "supabase_duplicate_audit.csv"
SUMMARY_PATH = ROOT / "supabase_duplicate_groups.csv"


def write_csv(path, columns, rows):
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(columns)
        writer.writerows(rows)


def main():
    dsn = os.environ.get("SUPABASE_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not dsn:
        print("Set SUPABASE_DATABASE_URL to the Supabase Postgres connection string.", file=sys.stderr)
        print("No database changes are made by this script.", file=sys.stderr)
        return 2

    sql = SQL_PATH.read_text(encoding="utf-8")
    connection = psycopg2.connect(dsn)
    connection.set_session(readonly=True, autocommit=False)
    try:
        with connection.cursor() as cursor:
            cursor.execute(sql)
            columns = [description[0] for description in cursor.description]
            rows = cursor.fetchall()
        connection.rollback()
    finally:
        connection.close()

    write_csv(OUTPUT_PATH, columns, rows)

    index = {name: position for position, name in enumerate(columns)}
    group_columns = [
        "duplicate_type", "duplicate_key", "record_count", "owners", "record_ids", "npis"
    ]
    groups = {}
    for row in rows:
        reasons = (row[index["duplicate_reasons"]] or "").split("; ")
        for reason in filter(None, reasons):
            if reason == "duplicate_npi":
                key = row[index["npi"]]
            elif reason == "duplicate_company_state":
                key = f"{row[index['company_key']]}|{row[index['state_key']]}"
            elif reason == "duplicate_state_phone":
                key = f"{row[index['state_key']]}|{row[index['phone_key']]}"
            else:
                key = f"{row[index['state_key']]}|{row[index['contact_phone_key']]}"
            groups.setdefault((reason, key), []).append(row)

    summary_rows = []
    for (reason, key), group in sorted(groups.items()):
        summary_rows.append([
            reason,
            key,
            len(group),
            "; ".join(sorted({str(row[index['owner']]) for row in group if row[index['owner']]})),
            "; ".join(str(row[index['id']]) for row in group),
            "; ".join(sorted({str(row[index['npi']]) for row in group if row[index['npi']]})),
        ])
    write_csv(SUMMARY_PATH, group_columns, summary_rows)
    print(f"duplicate_records={len(rows)} duplicate_groups={len(summary_rows)}")
    print(f"wrote={OUTPUT_PATH.name}")
    print(f"wrote={SUMMARY_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
