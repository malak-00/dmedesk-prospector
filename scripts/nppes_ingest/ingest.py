"""Ingest orchestration: source file -> validated rows -> staging.

The whole point of this module is the boundary it refuses to cross. It
writes to `refresh_runs` and `nppes_refresh_staging` and nothing else --
never `npi_records`, never `leads`. Applying staged data to the live
provider record is a separate transactional SQL step that compares
canonical values and writes `provider_field_history` before any overwrite.

Failure policy: if anything raises after the run row exists, the run is
marked `failed` and its partial staging rows are deleted, so a half-loaded
release can never be mistaken for a complete one.
"""

from __future__ import annotations

import csv
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator, Sequence

from .manifest import RunManifest, file_checksum
from .mapping import HeaderIndex, StagedProvider, map_deactivation_row, map_provider_row
from .supabase_rest import SupabaseClient
from .validate import Rejection, RowValidator, check_expected_row_count, summarize_rejections

REFRESH_RUNS_TABLE = "refresh_runs"
STAGING_TABLE = "nppes_refresh_staging"

RUN_TYPE_MONTHLY_FULL = "monthly-full"
RUN_TYPE_WEEKLY_INCREMENTAL = "weekly-incremental"
RUN_TYPE_DEACTIVATION = "deactivation"
RUN_TYPES = (RUN_TYPE_MONTHLY_FULL, RUN_TYPE_WEEKLY_INCREMENTAL, RUN_TYPE_DEACTIVATION)

DEFAULT_BATCH_SIZE = 500

# NPPES rows are wide; the default field-size cap trips on the taxonomy tail.
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


@dataclass
class IngestOptions:
    """Everything one run needs, already resolved from CLI arguments."""

    source_path: Path
    run_type: str
    output_dir: Path
    source_version: str | None = None
    release_date: str | None = None
    label: str | None = None
    states: frozenset[str] | None = None
    taxonomy_codes: frozenset[str] | None = None
    expect_rows: int | None = None
    row_count_tolerance: float = 5.0
    batch_size: int = DEFAULT_BATCH_SIZE
    dry_run: bool = False
    limit: int | None = None


@dataclass
class IngestResult:
    manifest: RunManifest
    manifest_path: Path
    rejects_path: Path | None


def read_source_rows(path: Path) -> Iterator[tuple[int, dict[str, str], HeaderIndex]]:
    """Stream (source row number, row, header index) from a CSV release.

    Row numbers are 1-based and count the header, so they line up with what
    a spreadsheet shows when someone opens the file to check a rejection.
    """
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise ValueError(f"{path} has no header row")
        index = HeaderIndex(list(reader.fieldnames))
        if index.resolve("npi") is None:
            raise ValueError(f"{path} has no NPI column -- is this an NPPES release?")
        for offset, row in enumerate(reader, start=2):
            yield offset, row, index


def _mapper_for(run_type: str) -> Callable[[HeaderIndex, dict[str, str], int], StagedProvider]:
    return map_deactivation_row if run_type == RUN_TYPE_DEACTIVATION else map_provider_row


def write_rejects_csv(path: Path, rejections: Sequence[Rejection]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["source_row_number", "npi", "reason", "detail"])
        for rejection in rejections:
            writer.writerow([rejection.source_row_number, rejection.npi, rejection.reason, rejection.detail])
    return path


def create_refresh_run(client: SupabaseClient, manifest: RunManifest) -> str:
    """Insert the `refresh_runs` row this load belongs to, status `staged`."""
    rows = client.insert(
        REFRESH_RUNS_TABLE,
        [
            {
                "source": "nppes",
                "source_version": manifest.source_version or manifest.release_date or manifest.run_type,
                "status": "staged",
                "row_count": manifest.accepted_rows,
                "metadata": manifest.to_run_metadata(),
            }
        ],
        returning=True,
    )
    if not rows or "id" not in rows[0]:
        raise RuntimeError("Creating the refresh_runs row returned no id")
    return str(rows[0]["id"])


def run_ingest(
    options: IngestOptions,
    client: SupabaseClient | None,
    *,
    log: Callable[[str], None] = print,
) -> IngestResult:
    """Validate a release and stage it under one refresh run."""
    if options.run_type not in RUN_TYPES:
        raise ValueError(f"Unknown run type {options.run_type!r}; expected one of {', '.join(RUN_TYPES)}")
    if not options.source_path.is_file():
        raise FileNotFoundError(f"Source file not found: {options.source_path}")
    if client is None and not options.dry_run:
        raise ValueError("A Supabase client is required unless --dry-run is set")

    log(f"Checksumming {options.source_path.name} ...")
    manifest = RunManifest(
        run_type=options.run_type,
        source_file=str(options.source_path),
        source_checksum=file_checksum(options.source_path),
        source_bytes=options.source_path.stat().st_size,
        source_version=options.source_version,
        release_date=options.release_date,
        label=options.label,
        dry_run=options.dry_run,
        filters={
            "states": sorted(options.states) if options.states else None,
            "taxonomy_codes": sorted(options.taxonomy_codes) if options.taxonomy_codes else None,
            "limit": options.limit,
        },
    )

    validator = RowValidator(
        states=options.states,
        taxonomy_codes=options.taxonomy_codes,
        # A deactivation row is only an NPI and a date -- requiring a name
        # would reject every row in the file.
        require_name=options.run_type != RUN_TYPE_DEACTIVATION,
    )
    mapper = _mapper_for(options.run_type)

    accepted: list[StagedProvider] = []
    rejections: list[Rejection] = []
    source_rows = 0

    for source_row_number, row, index in read_source_rows(options.source_path):
        source_rows += 1
        provider = mapper(index, row, source_row_number)
        rejection = validator.check(provider)
        if rejection is not None:
            rejections.append(rejection)
            continue
        accepted.append(provider)
        if options.limit is not None and len(accepted) >= options.limit:
            log(f"Stopping early at --limit {options.limit}")
            break

    manifest.source_rows = source_rows
    manifest.accepted_rows = len(accepted)
    manifest.rejected_rows = len(rejections)
    manifest.rejections_by_reason = summarize_rejections(rejections)

    log(
        f"Read {source_rows:,} source rows: {len(accepted):,} accepted, {len(rejections):,} rejected "
        f"({', '.join(f'{k}={v:,}' for k, v in sorted(manifest.rejections_by_reason.items())) or 'none'})"
    )

    stem = options.label or options.source_path.stem
    rejects_path: Path | None = None
    if rejections:
        rejects_path = write_rejects_csv(options.output_dir / f"{stem}.rejects.csv", rejections)
        log(f"Wrote rejected rows to {rejects_path}")

    # The count guard runs against raw source rows, not accepted rows: a
    # truncated download is what this is meant to catch, and our own state
    # and taxonomy filters legitimately remove most of a national file.
    try:
        check_expected_row_count(source_rows, options.expect_rows, options.row_count_tolerance)
    except Exception as err:
        manifest.finish("failed", str(err))
        manifest_path = manifest.write(options.output_dir / f"{stem}.manifest.json")
        raise RuntimeError(f"{err} (manifest: {manifest_path})") from err

    if not accepted:
        manifest.finish("failed", "no rows passed validation")
        manifest_path = manifest.write(options.output_dir / f"{stem}.manifest.json")
        raise RuntimeError(f"No rows passed validation; nothing staged (manifest: {manifest_path})")

    if options.dry_run or client is None:
        manifest.finish("dry-run")
        manifest_path = manifest.write(options.output_dir / f"{stem}.manifest.json")
        log(f"Dry run -- nothing was written to Supabase. Manifest: {manifest_path}")
        return IngestResult(manifest=manifest, manifest_path=manifest_path, rejects_path=rejects_path)

    refresh_run_id = create_refresh_run(client, manifest)
    manifest.refresh_run_id = refresh_run_id
    log(f"Created refresh run {refresh_run_id}")

    try:
        staged = 0
        for start in range(0, len(accepted), options.batch_size):
            batch = accepted[start : start + options.batch_size]
            client.insert(STAGING_TABLE, [provider.to_staging_row(refresh_run_id) for provider in batch])
            staged += len(batch)
            log(f"  staged {staged:,}/{len(accepted):,}")
        manifest.staged_rows = staged
    except Exception as err:
        # Leave nothing half-loaded: a partial staging set that still looks
        # `staged` is exactly the input that would make an apply step
        # report thousands of spurious provider changes.
        log(f"Staging failed ({err}); rolling back run {refresh_run_id}")
        try:
            client.delete(STAGING_TABLE, {"refresh_run_id": f"eq.{refresh_run_id}"})
        finally:
            manifest.finish("failed", str(err))
            client.update(
                REFRESH_RUNS_TABLE,
                {"id": f"eq.{refresh_run_id}"},
                {"status": "failed", "metadata": manifest.to_run_metadata()},
            )
        manifest_path = manifest.write(options.output_dir / f"{stem}.manifest.json")
        raise RuntimeError(f"Staging failed and was rolled back (manifest: {manifest_path}): {err}") from err

    manifest.finish("staged")
    client.update(
        REFRESH_RUNS_TABLE,
        {"id": f"eq.{refresh_run_id}"},
        {"row_count": manifest.staged_rows, "metadata": manifest.to_run_metadata()},
    )
    manifest_path = manifest.write(options.output_dir / f"{stem}.manifest.json")
    log(f"Staged {manifest.staged_rows:,} rows under refresh run {refresh_run_id}")
    log(f"Manifest: {manifest_path}")
    return IngestResult(manifest=manifest, manifest_path=manifest_path, rejects_path=rejects_path)
