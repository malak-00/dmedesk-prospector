"""Command-line interface.

Every input is an argument -- no hardcoded source paths, no hardcoded
output directory, no credentials in the file. `--dry-run` needs no
credentials at all, so a release can be validated before anyone decides to
load it.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from .config import ConfigError, load_supabase_config
from .ingest import (
    DEFAULT_BATCH_SIZE,
    RUN_TYPE_DEACTIVATION,
    RUN_TYPES,
    IngestOptions,
    run_ingest,
)
from .supabase_rest import SupabaseClient
from .taxonomies import TaxonomyError, fetch_enabled_taxonomy_codes, parse_taxonomy_codes

DEFAULT_OUTPUT_DIR = Path("scripts/out")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m nppes_ingest",
        description=(
            "Load an NPPES release into nppes_refresh_staging under one refresh run. "
            "Never writes npi_records or leads -- applying staged data is a separate SQL step."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("source", type=Path, help="Path to the NPPES release CSV")
    parser.add_argument(
        "--run-type",
        required=True,
        choices=RUN_TYPES,
        help="Which kind of NPPES release this file is",
    )
    parser.add_argument("--release-date", help="Release date of the source file, e.g. 2026-09-01")
    parser.add_argument("--source-version", help="Version/label recorded on refresh_runs.source_version")
    parser.add_argument("--label", help="Short run label; also names the manifest/rejects files")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Where to write manifest/rejects")

    filters = parser.add_argument_group("filters")
    filters.add_argument(
        "--states",
        default=None,
        help="Comma-separated state codes to keep (default: keep every state)",
    )
    filters.add_argument(
        "--taxonomy-codes",
        action="append",
        default=[],
        help="Explicit taxonomy codes to keep; repeatable. Overrides the taxonomies table.",
    )
    filters.add_argument(
        "--all-taxonomies",
        action="store_true",
        help="Skip taxonomy filtering entirely instead of reading public.taxonomies",
    )

    guards = parser.add_argument_group("safety guards")
    guards.add_argument("--expect-rows", type=int, help="Expected source row count; guards against a truncated file")
    guards.add_argument(
        "--row-count-tolerance",
        type=float,
        default=5.0,
        help="Percent tolerance allowed around --expect-rows",
    )
    guards.add_argument("--limit", type=int, help="Stop after N accepted rows (for a smoke test)")

    plumbing = parser.add_argument_group("plumbing")
    plumbing.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="Rows per staging insert")
    plumbing.add_argument("--env-file", type=Path, help="dotenv file with SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    plumbing.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and report without creating a refresh run or writing staging (needs no credentials)",
    )
    return parser


def resolve_states(raw: str | None) -> frozenset[str] | None:
    if not raw:
        return None
    codes = {part.strip().upper() for part in raw.replace(",", " ").split()}
    codes.discard("")
    return frozenset(codes) or None


def resolve_taxonomy_codes(args: argparse.Namespace, client: SupabaseClient | None) -> frozenset[str] | None:
    """Explicit codes win; otherwise read the enabled set from the database."""
    if args.all_taxonomies:
        return None
    if args.taxonomy_codes:
        return parse_taxonomy_codes(args.taxonomy_codes) or None
    # A deactivation file carries no taxonomy columns at all, so filtering on
    # taxonomy would reject the entire release.
    if args.run_type == RUN_TYPE_DEACTIVATION:
        return None
    if client is None:
        raise ConfigError(
            "Reading enabled taxonomies needs Supabase credentials. "
            "Pass --taxonomy-codes or --all-taxonomies to run offline."
        )
    return fetch_enabled_taxonomy_codes(client)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    client: SupabaseClient | None = None
    try:
        if args.dry_run:
            # A dry run needs no credentials, but it can still read the
            # enabled taxonomy set if they happen to be available. When they
            # aren't, leave the client unset and let resolve_taxonomy_codes
            # decide whether that's actually a problem for this run.
            try:
                client = SupabaseClient(load_supabase_config(args.env_file))
            except ConfigError:
                client = None
        else:
            client = SupabaseClient(load_supabase_config(args.env_file))

        taxonomy_codes = resolve_taxonomy_codes(args, client)
    except (ConfigError, TaxonomyError) as err:
        print(f"error: {err}", flush=True)
        return 2

    options = IngestOptions(
        source_path=args.source,
        run_type=args.run_type,
        output_dir=args.output_dir,
        source_version=args.source_version,
        release_date=args.release_date,
        label=args.label,
        states=resolve_states(args.states),
        taxonomy_codes=taxonomy_codes,
        expect_rows=args.expect_rows,
        row_count_tolerance=args.row_count_tolerance,
        batch_size=args.batch_size,
        dry_run=args.dry_run,
        limit=args.limit,
    )

    try:
        run_ingest(options, None if args.dry_run else client)
    except (FileNotFoundError, ValueError, RuntimeError) as err:
        print(f"error: {err}", flush=True)
        return 1
    return 0
