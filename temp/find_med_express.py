from pathlib import Path
import openpyxl

path = Path("BD MEETINGS 2026 (11).xlsx")
book = openpyxl.load_workbook(path, read_only=True, data_only=True)
for sheet in book.worksheets:
    rows = sheet.iter_rows(values_only=True)
    header = next(rows, None)
    if not header:
        continue
    for row_number, row in enumerate(rows, start=2):
        text = " | ".join("" if v is None else str(v) for v in row)
        if "MED EXPRESS" in text.upper():
            print(sheet.title, row_number, repr(row))
