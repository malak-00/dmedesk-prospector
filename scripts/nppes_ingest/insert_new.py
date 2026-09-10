"""Insert new NPPES providers into npi_records without updating existing rows.

The command is intentionally separate from the refresh lifecycle apply. It is
for the August lead intake while the grouping system is being finalized.

Examples:
  python -m nppes_ingest.insert_new FILE.csv --taxonomy-codes 332B00000X,333600000X
  python -m nppes_ingest.insert_new FILE.csv --taxonomy-codes CODE1,CODE2 --apply
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

from .config import load_supabase_config
from .mapping import HeaderIndex, map_provider_row
from .supabase_rest import SupabaseClient

COMPANY_KEYWORDS = [
    "beauty", "lingerie", "bra", "hair", "optics", "hearing", "ophthalmology",
    "opthamology", "wig", "sleep", "hospital", "university", "state of",
    "city of", "super market", "county of", "regents", "cvs", "piggly wiggly",
    "publix", "wellpartner", "walmart", "wal green", "walgreen", "wal-mart",
    "scooter store", "holiday cvs", "hook-superx", "mayo clinic",
]

OFFICIALS = {
    "jeffrey barnhard", "jennifer l simmons", "jennifer spector", "vishal lal",
    "david r schools", "stephen griggs", "scott kaltrider", "rachel a mazur",
    "sheryl price", "sheryl s price", "yosef meystel", "martin t fuller",
    "meenal sethna", "richard binstein", "jason cone", "craig ireland",
    "debbie brewer", "greg crawford", "gregory j crawford", "janna king",
    "rachel mazur", "rachel anne mazur", "susan colbert", "wendy russ",
}

def norm(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()

def excluded(provider) -> str | None:
    name = norm(provider.name)
    if any(keyword in name for keyword in COMPANY_KEYWORDS):
        return "bd_main_company_keyword"
    official = norm(f"{provider.authorizedofficial_firstname or ''} {provider.authorizedofficial_lastname or ''}")
    if official in OFFICIALS:
        return "bd_main_authorized_official"
    return None

def to_live_row(provider) -> dict:
    return {
        "npi": provider.npi,
        "enumerationtype": provider.enumerationtype,
        "name": provider.name,
        "isorganization": provider.isorganization,
        "status": provider.status,
        "address_line1": provider.address_line1,
        "address_line2": provider.address_line2,
        "address_city": provider.address_city,
        "address_state": provider.address_state,
        "address_postalcode": provider.address_postal_code,
        "address_countrycode": "US",
        "phone": provider.phone,
        "taxonomy_code": provider.taxonomy_code,
        "authorizedofficial_firstname": provider.authorizedofficial_firstname,
        "authorizedofficial_lastname": provider.authorizedofficial_lastname,
        "authorizedofficial_title": provider.authorizedofficial_title,
        "authorizedofficial_phone": provider.authorizedofficial_phone,
        "lastupdated": provider.lastupdated,
        "enumeration_date": provider.enumeration_date,
    }

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--taxonomy-codes", required=True, help="Exactly two taxonomy codes, comma-separated")
    parser.add_argument("--apply", action="store_true", help="Insert into npi_records; without this, report only")
    parser.add_argument("--chunk-size", type=int, default=500)
    args = parser.parse_args()
    codes = {code.strip().upper() for code in args.taxonomy_codes.split(",") if code.strip()}
    if len(codes) != 2:
        parser.error("--taxonomy-codes must contain exactly two codes")
    if not args.source.is_file():
        parser.error(f"NPPES CSV not found: {args.source}")

    candidates = []
    stats = {"input": 0, "taxonomy_match": 0, "excluded": 0, "duplicate_in_file": 0}
    seen = set()
    with args.source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        index = HeaderIndex(reader.fieldnames or [])
        for row_number, raw in enumerate(reader, start=2):
            stats["input"] += 1
            provider = map_provider_row(index, raw, row_number)
            if not set(provider.taxonomy_codes).intersection(codes):
                continue
            stats["taxonomy_match"] += 1
            if provider.npi in seen:
                stats["duplicate_in_file"] += 1
                continue
            seen.add(provider.npi)
            if excluded(provider):
                stats["excluded"] += 1
                continue
            candidates.append(provider)

    existing = set()
    client = None
    if args.apply:
        client = SupabaseClient(load_supabase_config())
        for start in range(0, len(candidates), args.chunk_size):
            values = [p.npi for p in candidates[start:start + args.chunk_size]]
            if values:
                existing.update(row["npi"] for row in client.select("npi_records", columns="npi", filters={"npi": "in.(" + ",".join(values) + ")"}))
        candidates = [p for p in candidates if p.npi not in existing]
        for start in range(0, len(candidates), args.chunk_size):
            client.insert("npi_records", [to_live_row(p) for p in candidates[start:start + args.chunk_size]])

    stats.update({"new_candidates": len(candidates), "already_existing": len(existing), "inserted": len(candidates) if args.apply else 0})
    print(stats)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

