import os
import re
import sys
import pandas as pd
from supabase import create_client, Client

# ==========================================
# Target: dmedesk-prospector Supabase project
# ==========================================
SUPABASE_URL  = "https://pcvyrkisvvtiteoiuplg.supabase.co"
SUPABASE_KEY  = "sb_secret_3B5fLOoD6QUyZK-tHq3jmQ_GZmfxGl6"
TABLE_NAME    = "npi_records"
CSV_FILE_PATH = r"C:\Users\ben.arthur\AppData\Local\Programs\Python\Python313\supaaaa.csv"

# Batch size -- PostgREST handles 500-1000 rows comfortably
BATCH_SIZE = 700


def sanitize_column_name(col_name: str) -> str:
    """Convert raw CSV headers to Postgres-friendly lowercase identifiers.
    E.g. 'Employer Identification Number (EIN)' -> 'employer_identification_number_ein'
    """
    cleaned = col_name.strip().lower()
    cleaned = re.sub(r'[\s/()\-\.,]+', '_', cleaned)
    cleaned = re.sub(r'_+', '_', cleaned).strip('_')
    return cleaned


def migrate():
    if not os.path.exists(CSV_FILE_PATH):
        print(f"ERROR: CSV not found at {CSV_FILE_PATH}", file=sys.stderr)
        sys.exit(1)

    print(f"Connecting to {SUPABASE_URL} ...")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Quick connectivity check -- fail fast if table doesn't exist yet
    try:
        supabase.table(TABLE_NAME).select("npi").limit(1).execute()
        print(f"Connected. Target table '{TABLE_NAME}' is reachable.")
    except Exception as e:
        print(
            f"ERROR: Cannot reach table '{TABLE_NAME}'. "
            f"Make sure the table exists in the destination project.\n{e}",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"\nReading CSV in chunks of {BATCH_SIZE} rows ...")
    print(f"Source: {CSV_FILE_PATH}\n")

    batch_num  = 0
    total_rows = 0
    errors     = 0

    for chunk in pd.read_csv(CSV_FILE_PATH, chunksize=BATCH_SIZE, low_memory=False):
        batch_num += 1

        # Sanitize column headers
        chunk.columns = [sanitize_column_name(c) for c in chunk.columns]

        # Convert NaN / empty values -> None (stored as NULL in Postgres)
        chunk = chunk.astype(object).where(pd.notnull(chunk), None)

        records = chunk.to_dict(orient="records")

        try:
            supabase.table(TABLE_NAME).insert(records).execute()
            total_rows += len(records)
            print(f"  Batch {batch_num:>4}  |  {len(records):>4} rows  |  Total: {total_rows:>7}")
        except Exception as e:
            errors += 1
            print(f"  Batch {batch_num:>4}  ERROR: {e}", file=sys.stderr)
            if errors >= 5:
                print("Too many consecutive errors -- aborting.", file=sys.stderr)
                break

    print(f"\nDone. Rows inserted: {total_rows}  |  Failed batches: {errors}")


if __name__ == "__main__":
    try:
        migrate()
    except KeyboardInterrupt:
        print("\nInterrupted by user.")
    except Exception:
        import traceback
        traceback.print_exc()
    input("\nPress Enter to exit...")
