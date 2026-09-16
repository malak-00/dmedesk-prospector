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
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator, Sequence

from .manifest import RunManifest, file_checksum_and_lines
from .mapping import HeaderIndex, StagedProvider, map_deactivation_row, map_provider_row
from .supabase_rest import SupabaseClient
from .validate import Rejection, RowValidator, check_expected_row_count

REFRESH_RUNS_TABLE = "refresh_runs"
STAGING_TABLE = "nppes_refresh_staging"


def _format_time(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h}h{m:02d}m{s:02d}s"
    return f"{m:02d}m{s:02d}s"


def _print_progress(current: int, total: int | None, accepted: int, start_time: float) -> None:
    """Write a dynamic single-line progress bar with rate and ETA to stderr."""
    elapsed = max(time.time() - start_time, 0.001)
    rate = current / elapsed
    if total:
        pct = min(current / total, 1.0)
        filled = int(pct * 30)
        bar = "=" * filled + "-" * (30 - filled)
        remaining = max(total - current, 0)
        eta_sec = remaining / rate if rate > 0 else 0
        line = f"\r[{bar}] {pct:5.1%} | {current:,}/{total:,} rows | {rate:,.0f} r/s | acc: {accepted:,} | ETA: {_format_time(eta_sec)}"
    else:
        line = f"\r{current:,} rows | {rate:,.0f} r/s | acc: {accepted:,} | {_format_time(elapsed)}"
    sys.stderr.write(line[:120].ljust(120))
    sys.stderr.flush()


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
    # The CLI turns this on by default (--include-individuals turns it off).
    organizations_only: bool = False
    skip_checksum: bool = False


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


class RejectsWriter:
    """Streams rejections to CSV as they happen; the file only appears if there are any.

    A national file rejects millions of rows (mostly out-of-scope taxonomies),
    so they are written out rather than kept in memory.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._handle = None
        self._writer = None

    def write(self, rejection: Rejection) -> None:
        if self._writer is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._handle = self.path.open("w", encoding="utf-8", newline="")
            self._writer = csv.writer(self._handle)
            self._writer.writerow(["source_row_number", "npi", "reason", "detail"])
        self._writer.writerow([rejection.source_row_number, rejection.npi, rejection.reason, rejection.detail])

    def close(self) -> Path | None:
        if self._handle is None:
            return None
        self._handle.close()
        self._handle = None
        return self.path


def create_refresh_run(client: SupabaseClient, manifest: RunManifest) -> str:
    """Insert a run marked uploading until every staging batch succeeds."""
    metadata = manifest.to_run_metadata()
    metadata.update({
        "staging_state": "uploading",
        "expected_staged_rows": manifest.accepted_rows,
    })
    rows = client.insert(
        REFRESH_RUNS_TABLE,
        [
            {
                "source": "nppes",
                "source_version": manifest.source_version or manifest.release_date or manifest.run_type,
                "status": "staged",
                "row_count": manifest.accepted_rows,
                "metadata": metadata,
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

    if options.skip_checksum:
        log("Skipping checksum (--skip-checksum)")
        # Avoid reading the file at all -- use expect_rows (+1 for the header)
        # as the line count so the truncated-file guard is still satisfied.
        checksum = ""
        line_count = (options.expect_rows + 1) if options.expect_rows is not None else 0
    else:
        log(f"Checksumming {options.source_path.name} ...")
        checksum, line_count = file_checksum_and_lines(options.source_path)
    manifest = RunManifest(
        run_type=options.run_type,
        source_file=str(options.source_path),
        source_checksum=checksum,
        source_bytes=options.source_path.stat().st_size,
        source_version=options.source_version,
        release_date=options.release_date,
        label=options.label,
        dry_run=options.dry_run,
        filters={
            "states": sorted(options.states) if options.states else None,
            "taxonomy_codes": sorted(options.taxonomy_codes) if options.taxonomy_codes else None,
            "limit": options.limit,
            "organizations_only": options.organizations_only and options.run_type != RUN_TYPE_DEACTIVATION,
        },
    )
    stem = options.label or options.source_path.stem

    def fail_before_staging(message: str) -> RuntimeError:
        manifest.finish("failed", message)
        manifest_path = manifest.write(options.output_dir / f"{stem}.manifest.json")
        return RuntimeError(f"{message} (manifest: {manifest_path})")

    # The count guard runs against raw source rows, not accepted rows: a
    # truncated download is what this is meant to catch, and our own state
    # and taxonomy filters legitimately remove most of a national file. The
    # line count (minus the header) is checked before anything is staged;
    # the exact parsed row count is checked again once the file is read.
    try:
        check_expected_row_count(max(line_count - 1, 0), options.expect_rows, options.row_count_tolerance)
    except Exception as err:
        raise fail_before_staging(str(err)) from err

    validator = RowValidator(
        states=options.states,
        taxonomy_codes=options.taxonomy_codes,
        # A deactivation row is only an NPI and a date -- requiring a name
        # would reject every row in the file.
        require_name=options.run_type != RUN_TYPE_DEACTIVATION,
        # A deactivation row carries no entity type, so it can't be filtered.
        organizations_only=options.organizations_only and options.run_type != RUN_TYPE_DEACTIVATION,
    )
    mapper = _mapper_for(options.run_type)
    rejects = RejectsWriter(options.output_dir / f"{stem}.rejects.csv")
    rejection_counts: dict[str, int] = {}
    staging_enabled = not options.dry_run and client is not None

    # Rows are staged in batches as the file is read, so memory stays flat
    # for a full national release. The refresh run is created lazily with
    # the first batch: a file with no accepted rows never creates one.
    refresh_run_id: str | None = None
    batch: list[dict] = []
    source_rows = 0
    accepted_rows = 0
    staged = 0

    def flush() -> None:
        nonlocal refresh_run_id, staged
        if not batch:
            return
        if refresh_run_id is None:
            refresh_run_id = create_refresh_run(client, manifest)
            manifest.refresh_run_id = refresh_run_id
            log(f"Created refresh run {refresh_run_id}")
        client.insert(STAGING_TABLE, [dict(row, refresh_run_id=refresh_run_id) for row in batch])
        staged += len(batch)
        batch.clear()
        sys.stderr.write("\r" + " " * 120 + "\r")
        sys.stderr.flush()
        log(f"  staged {staged:,}")

    try:
        total_rows = options.expect_rows if options.expect_rows else None
        start_time = time.time()
        last_progress_time = 0.0
        _print_progress(0, total_rows, 0, start_time)
        for source_row_number, row, index in read_source_rows(options.source_path):
            source_rows += 1
            now = time.time()
            if source_rows % 5_000 == 0 or (now - last_progress_time >= 0.5):
                _print_progress(source_rows, total_rows, accepted_rows, start_time)
                last_progress_time = now
            provider = mapper(index, row, source_row_number)
            rejection = validator.check(provider)
            if rejection is not None:
                rejection_counts[rejection.reason] = rejection_counts.get(rejection.reason, 0) + 1
                rejects.write(rejection)
                continue
            accepted_rows += 1
            if staging_enabled:
                batch.append(provider.to_staging_row(""))
                if len(batch) >= options.batch_size:
                    flush()
            if options.limit is not None and accepted_rows >= options.limit:
                log(f"Stopping early at --limit {options.limit}")
                break
        sys.stderr.write("\r" + " " * 120 + "\r")  # clear the progress line
        sys.stderr.flush()
        rejects_path = rejects.close()

        manifest.source_rows = source_rows
        manifest.accepted_rows = accepted_rows
        manifest.rejected_rows = sum(rejection_counts.values())
        manifest.rejections_by_reason = dict(sorted(rejection_counts.items()))
        log(
            f"Read {source_rows:,} source rows: {accepted_rows:,} accepted, {manifest.rejected_rows:,} rejected "
            f"({', '.join(f'{k}={v:,}' for k, v in manifest.rejections_by_reason.items()) or 'none'})"
        )
        if rejects_path is not None:
            log(f"Wrote rejected rows to {rejects_path}")

        if options.limit is None:
            check_expected_row_count(source_rows, options.expect_rows, options.row_count_tolerance)

        if not accepted_rows:
            raise fail_before_staging("No rows passed validation; nothing staged")

        if not staging_enabled:
            manifest.finish("dry-run")
            manifest_path = manifest.write(options.output_dir / f"{stem}.manifest.json")
            log(f"Dry run -- nothing was written to Supabase. Manifest: {manifest_path}")
            return IngestResult(manifest=manifest, manifest_path=manifest_path, rejects_path=rejects_path)

        flush()
        manifest.staged_rows = staged
        manifest.finish("staged")
        complete_metadata = manifest.to_run_metadata()
        complete_metadata.update({
            "staging_state": "complete",
            "expected_staged_rows": manifest.accepted_rows,
            "staged_rows": manifest.staged_rows,
        })
        client.update(
            REFRESH_RUNS_TABLE,
            {"id": f"eq.{refresh_run_id}"},
            {"row_count": manifest.staged_rows, "metadata": complete_metadata},
        )
        manifest_path = manifest.write(options.output_dir / f"{stem}.manifest.json")
    except Exception as err:
        rejects.close()
        if refresh_run_id is None:
            # Nothing reached Supabase (dry run, a guard, or a read error
            # before the first batch) -- just record the failure locally.
            if isinstance(err, RuntimeError) and "(manifest:" in str(err):
                raise
            raise fail_before_staging(str(err)) from err
        # Leave nothing half-loaded: a partial staging set that still looks
        # `staged` is exactly the input that would make an apply step
        # report thousands of spurious provider changes.
        manifest.staged_rows = staged
        log(f"Staging failed ({err}); rolling back run {refresh_run_id}")
        try:
            client.delete(STAGING_TABLE, {"refresh_run_id": f"eq.{refresh_run_id}"})
        except Exception as cleanup_err:
            log(f"Could not delete failed staging rows: {cleanup_err}")
        manifest.finish("failed", str(err))
        failed_metadata = manifest.to_run_metadata()
        failed_metadata.update({
            "staging_state": "failed",
            "expected_staged_rows": manifest.accepted_rows,
            "staged_rows": manifest.staged_rows,
        })
        try:
            client.update(
                REFRESH_RUNS_TABLE,
                {"id": f"eq.{refresh_run_id}"},
                {"status": "failed", "metadata": failed_metadata},
            )
        except Exception as mark_err:
            log(f"Could not mark refresh run failed: {mark_err}")
        manifest_path = manifest.write(options.output_dir / f"{stem}.manifest.json")
        raise RuntimeError(f"Staging failed and was rolled back (manifest: {manifest_path}): {err}") from err

    log(f"Staged {manifest.staged_rows:,} rows under refresh run {refresh_run_id}")
    log(f"Manifest: {manifest_path}")
    return IngestResult(manifest=manifest, manifest_path=manifest_path, rejects_path=rejects_path)
