"""Load CMS Medicare DMEPOS "by Supplier" data into npi_cms_enrichment.

    python -m nppes_ingest.medicare --dry-run
    python -m nppes_ingest.medicare --apply

Pages the free, keyless CMS data API into `medicare_refresh_staging` under one
`refresh_runs` row (source 'medicare'), then -- with --apply -- calls
`apply_medicare_refresh` (sql/012_medicare_refresh.sql), which updates
`npi_cms_enrichment`, records changes in `provider_field_history`, and raises
review alerts for claimed leads whose claims fell by more than half.

CMS publishes a new data year once a year as a new dataset version. By
default the loader looks the newest version up in the CMS catalog
(data.json) and falls back to the last known version; the run always prints
and records which version it used. Pass --dataset-id to pin one. Re-applying
identical content is refused by the database, so running this monthly is
safe: most runs stage the same year and stop there.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

from .config import ConfigError, load_supabase_config
from .supabase_rest import SupabaseClient
from .validate import is_valid_npi

DEFAULT_DATASET_ID = "a2d56d3f-3531-4315-9d87-e29986516b41"
DATASET_TITLE = "Medicare Durable Medical Equipment, Devices & Supplies - by Supplier"
CATALOG_URL = "https://data.cms.gov/data.json"
API_URL = "https://data.cms.gov/data-api/v1/dataset/{dataset_id}/data"
STATS_URL = "https://data.cms.gov/data-api/v1/dataset/{dataset_id}/data-viewer/stats"

REFRESH_RUNS_TABLE = "refresh_runs"
STAGING_TABLE = "medicare_refresh_staging"
DEFAULT_PAGE_SIZE = 5000
DEFAULT_BATCH_SIZE = 1000
RUN_TYPE = "medicare-dmepos-supplier"

# CMS field -> npi_cms_enrichment column
FIELDS = {
    "Tot_Suplr_Clms": "total_claims",
    "Tot_Suplr_Srvcs": "total_services",
    "Tot_Suplr_Benes": "total_beneficiaries",
    "Suplr_Mdcr_Pymt_Amt": "medicare_payment",
    "Suplr_Mdcr_Alowd_Amt": "medicare_allowed",
}

UUID_IN_URL = re.compile(r"/dataset/([0-9a-fA-F-]{36})")
YEAR = re.compile(r"(19|20)\d{2}")

FetchJson = Callable[[str], Any]


def http_fetch_json(url: str, *, timeout: int = 120, attempts: int = 4) -> Any:
    """GET a JSON document with retries on network errors and 5xx."""
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "dmedesk-prospector-refresh"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            if err.code < 500:
                raise RuntimeError(f"GET {url} failed with HTTP {err.code}") from err
            last = err
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            last = err
        if attempt < attempts:
            time.sleep(2 * attempt)
    raise RuntimeError(f"GET {url} failed: {last}")


def parse_number(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def discover_latest_dataset(fetch_json: FetchJson) -> tuple[str, str] | None:
    """Newest data-API version of the DMEPOS by-Supplier dataset in the CMS catalog.

    Returns (dataset_id, label) or None if the catalog can't be read or the
    dataset isn't found; the caller falls back to a known version.
    """
    try:
        catalog = fetch_json(CATALOG_URL)
    except Exception:
        return None
    best: tuple[int, str, str] | None = None
    for dataset in (catalog or {}).get("dataset", []) or []:
        if str(dataset.get("title", "")).strip().lower() != DATASET_TITLE.lower():
            continue
        for dist in dataset.get("distribution", []) or []:
            url = str(dist.get("accessURL") or dist.get("downloadURL") or "")
            match = UUID_IN_URL.search(url)
            if not match or "/data-api/" not in url:
                continue
            years = [int(y.group(0)) for y in YEAR.finditer(f"{dist.get('temporal', '')} {dist.get('title', '')}")]
            year = max(years) if years else 0
            label = str(dist.get("title") or dist.get("temporal") or match.group(1))
            if best is None or year > best[0]:
                best = (year, match.group(1), label)
    return (best[1], best[2]) if best else None


def fetch_total_rows(fetch_json: FetchJson, dataset_id: str) -> int | None:
    """Row count from the data API's stats endpoint, if it reports one."""
    try:
        stats = fetch_json(STATS_URL.format(dataset_id=dataset_id))
    except Exception:
        return None
    candidates: list[int] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if isinstance(value, (dict, list)):
                    walk(value)
                elif "row" in str(key).lower() and isinstance(value, (int, float)) and not isinstance(value, bool):
                    candidates.append(int(value))
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(stats)
    return max(candidates) if candidates else None


def fetch_rows(fetch_json: FetchJson, dataset_id: str, page_size: int) -> Iterator[dict[str, Any]]:
    offset = 0
    while True:
        page = fetch_json(f"{API_URL.format(dataset_id=dataset_id)}?size={page_size}&offset={offset}")
        if not isinstance(page, list):
            raise RuntimeError(f"Unexpected CMS API response at offset {offset}")
        if not page:
            return
        yield from page
        if len(page) < page_size:
            return
        offset += len(page)


@dataclass
class MedicareOptions:
    output_dir: Path
    dataset_id: str | None = None
    discover: bool = True
    page_size: int = DEFAULT_PAGE_SIZE
    batch_size: int = DEFAULT_BATCH_SIZE
    dry_run: bool = False
    apply: bool = False
    label: str | None = None


@dataclass
class MedicareResult:
    dataset_id: str
    dataset_label: str
    source_rows: int = 0
    staged_rows: int = 0
    rejected: dict[str, int] = field(default_factory=dict)
    content_checksum: str = ""
    refresh_run_id: str | None = None
    applied: dict[str, Any] | None = None
    manifest_path: Path | None = None


def run_medicare_refresh(
    options: MedicareOptions,
    client: Any,
    *,
    fetch_json: FetchJson = http_fetch_json,
    log: Callable[[str], None] = print,
) -> MedicareResult:
    if client is None and not options.dry_run:
        raise ValueError("A Supabase client is required unless --dry-run is set")
    if options.apply and options.dry_run:
        raise ValueError("--apply can't be combined with --dry-run")

    dataset_id, label = options.dataset_id, options.dataset_id or ""
    if not dataset_id and options.discover:
        found = discover_latest_dataset(fetch_json)
        if found:
            dataset_id, label = found
            log(f"Newest CMS DMEPOS by-Supplier version in the catalog: {label} ({dataset_id})")
        else:
            log("Couldn't find the dataset in the CMS catalog; using the last known version")
    if not dataset_id:
        dataset_id, label = DEFAULT_DATASET_ID, f"default ({DEFAULT_DATASET_ID})"

    result = MedicareResult(dataset_id=dataset_id, dataset_label=label)
    expected = fetch_total_rows(fetch_json, dataset_id)
    log(f"Loading dataset {dataset_id}" + (f" ({expected:,} rows reported)" if expected else ""))

    digest = hashlib.sha256()
    seen: set[str] = set()
    batch: list[dict[str, Any]] = []
    run_id: str | None = None

    def create_run() -> str:
        rows = client.insert(REFRESH_RUNS_TABLE, [{
            "source": "medicare",
            "source_version": label or dataset_id,
            "status": "staged",
            "row_count": 0,
            "metadata": {"run_type": RUN_TYPE, "dataset_id": dataset_id, "dataset_label": label, "staging_state": "uploading"},
        }], returning=True)
        if not rows or "id" not in rows[0]:
            raise RuntimeError("Creating the refresh_runs row returned no id")
        return str(rows[0]["id"])

    def flush() -> None:
        nonlocal run_id
        if not batch or options.dry_run:
            batch.clear()
            return
        if run_id is None:
            run_id = create_run()
            result.refresh_run_id = run_id
            log(f"Created refresh run {run_id}")
        client.insert(STAGING_TABLE, [dict(row, refresh_run_id=run_id) for row in batch])
        result.staged_rows += len(batch)
        batch.clear()

    def reject(reason: str) -> None:
        result.rejected[reason] = result.rejected.get(reason, 0) + 1

    try:
        for raw in fetch_rows(fetch_json, dataset_id, options.page_size):
            result.source_rows += 1
            npi = str(raw.get("Suplr_NPI") or "").strip()
            if not is_valid_npi(npi):
                reject("bad_npi")
                continue
            if npi in seen:
                reject("duplicate_npi")
                continue
            seen.add(npi)
            row = {"npi": npi}
            for source_field, column in FIELDS.items():
                row[column] = parse_number(raw.get(source_field))
            digest.update(json.dumps(row, sort_keys=True).encode("utf-8"))
            batch.append(row)
            if len(batch) >= options.batch_size:
                flush()
            if result.source_rows % 20000 == 0:
                log(f"  read {result.source_rows:,} rows")

        if expected is not None and result.source_rows < expected:
            raise RuntimeError(f"CMS API returned {result.source_rows:,} rows but reports {expected:,}; refusing a partial release")
        if not seen:
            raise RuntimeError("No valid rows were returned by the CMS API")

        result.content_checksum = digest.hexdigest()
        if options.dry_run:
            log(f"Dry run: {len(seen):,} valid suppliers ({result.source_rows:,} rows read, rejected: {result.rejected or 'none'}). Nothing written.")
            result.manifest_path = _write_manifest(options, result, "dry-run")
            return result

        flush()
        client.update(REFRESH_RUNS_TABLE, {"id": f"eq.{run_id}"}, {
            "row_count": result.staged_rows,
            "metadata": {
                "run_type": RUN_TYPE, "dataset_id": dataset_id, "dataset_label": label,
                "staging_state": "complete", "source_rows": result.source_rows, "staged_rows": result.staged_rows,
                "expected_rows": expected, "rejected": result.rejected, "content_checksum": result.content_checksum,
            },
        })
        log(f"Staged {result.staged_rows:,} suppliers under refresh run {run_id}")
    except Exception as err:
        if run_id is not None:
            log(f"Staging failed ({err}); rolling back run {run_id}")
            try:
                client.delete(STAGING_TABLE, {"refresh_run_id": f"eq.{run_id}"})
                client.update(REFRESH_RUNS_TABLE, {"id": f"eq.{run_id}"}, {
                    "status": "failed",
                    "metadata": {"run_type": RUN_TYPE, "dataset_id": dataset_id, "staging_state": "failed", "failure_reason": str(err)},
                })
            except Exception as cleanup_err:  # pragma: no cover - best effort
                log(f"Could not clean up run {run_id}: {cleanup_err}")
        result.manifest_path = _write_manifest(options, result, "failed", str(err))
        raise

    if options.apply:
        result.applied = client.rpc("apply_medicare_refresh", {"p_run_id": run_id})
        log(f"Applied: {result.applied}")
    result.manifest_path = _write_manifest(options, result, "applied" if options.apply else "staged")
    return result


def _write_manifest(options: MedicareOptions, result: MedicareResult, status: str, error: str | None = None) -> Path:
    stem = options.label or f"medicare-{datetime.now(timezone.utc).strftime('%Y%m%d')}"
    path = options.output_dir / f"{stem}.manifest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "status": status, "error": error, "dataset_id": result.dataset_id, "dataset_label": result.dataset_label,
        "source_rows": result.source_rows, "staged_rows": result.staged_rows, "rejected": result.rejected,
        "content_checksum": result.content_checksum, "refresh_run_id": result.refresh_run_id, "applied": result.applied,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m nppes_ingest.medicare", description=__doc__.split("\n\n")[0])
    parser.add_argument("--dataset-id", help="Pin a CMS dataset version UUID instead of discovering the newest")
    parser.add_argument("--no-discover", action="store_true", help="Don't read the CMS catalog; use --dataset-id or the last known version")
    parser.add_argument("--apply", action="store_true", help="Apply the staged release to npi_cms_enrichment")
    parser.add_argument("--dry-run", action="store_true", help="Read and validate only; write nothing (needs no credentials)")
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--label", help="Names the manifest file")
    parser.add_argument("--output-dir", type=Path, default=Path("scripts/out"))
    parser.add_argument("--env-file", type=Path)
    args = parser.parse_args(argv)

    if args.apply and args.dry_run:
        print("error: --apply can't be combined with --dry-run", flush=True)
        return 2
    options = MedicareOptions(
        output_dir=args.output_dir, dataset_id=args.dataset_id, discover=not args.no_discover,
        page_size=args.page_size, batch_size=args.batch_size, dry_run=args.dry_run, apply=args.apply, label=args.label,
    )
    try:
        client = None if args.dry_run else SupabaseClient(load_supabase_config(args.env_file))
        run_medicare_refresh(options, client)
    except (ConfigError, RuntimeError, ValueError) as err:
        print(f"error: {err}", flush=True)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
