"""Command-line interface.

Every input is an argument -- no hardcoded source paths, no hardcoded
output directory, no credentials in the file. `--dry-run` needs no
credentials at all, so a release can be validated before anyone decides to
load it.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from .apply import DEFAULT_APPLY_BATCH_SIZE, run_apply, run_lead_sync
from .config import ConfigError, load_supabase_config
from .exclusions import DEFAULT_EXCLUSION_BATCH_SIZE, run_apply_exclusions, run_remove_excluded
from .registry_match import DEFAULT_MAX_BUCKET, run_registry_match
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
# Applied to every non-deactivation run unless --no-exclude-keywords is passed.
DEFAULT_EXCLUDE_KEYWORDS_FILE = Path(__file__).resolve().parent / "exclude_keywords.txt"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m nppes_ingest",
        description=(
            "Stage an NPPES release into nppes_refresh_staging under one refresh run, and optionally "
            "apply it to npi_records in batches (--apply, or --apply-run for an already staged run). "
            "Never writes leads."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("source", type=Path, nargs="?", help="Path to the NPPES release CSV")
    parser.add_argument(
        "--run-type",
        required=False,
        choices=RUN_TYPES,
        help="Which kind of NPPES release this file is",
    )
    parser.add_argument(
        "--apply-run",
        help="Apply an already staged run (by UUID) to npi_records in batches; resumes an interrupted apply. "
        "On a run that is already applied it brings claimed leads up to date instead",
    )
    parser.add_argument(
        "--sync-run",
        help="Only refresh claimed leads from an already applied run (by UUID) and raise provider-change alerts "
        "(sql/015) -- for a release that was applied before that step existed",
    )
    parser.add_argument(
        "--restart",
        action="store_true",
        help="With --sync-run: start the sync over instead of resuming, for a run that has been synced before "
        "(needs sql/017). Re-running raises no alert twice",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="After staging the source file, apply it to npi_records in the same command",
    )
    parser.add_argument(
        "--apply-batch-size",
        type=int,
        default=DEFAULT_APPLY_BATCH_SIZE,
        help="Staged rows per apply transaction",
    )
    parser.add_argument(
        "--skip-lead-sync",
        action="store_true",
        help="Don't refresh claimed leads from the applied release or raise provider-change alerts "
        "(sql/015). The sync can be run later by applying the same run again",
    )
    parser.add_argument(
        "--match-registry",
        action="store_true",
        help="Only rebuild registry-wide identity match candidates (sql/030) from npi_records -- for the first "
        "load, or to rerun after a release was applied without it",
    )
    parser.add_argument(
        "--skip-registry-match",
        action="store_true",
        help="After applying a release, don't rebuild registry-wide identity match candidates (sql/030)",
    )
    parser.add_argument(
        "--match-max-bucket",
        type=int,
        default=DEFAULT_MAX_BUCKET,
        help="Largest group of NPIs sharing one key (official+phone, name+phone, name+official) that is still paired",
    )
    parser.add_argument("--recover-run", help="Finalize an interrupted uploading run by UUID")
    parser.add_argument("--abort-run", help="Abort an uploading run by UUID")
    parser.add_argument("--reason", help="Required reason for --abort-run")
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
        "--include-individuals",
        action="store_true",
        help="Also stage individual providers (NPI type 1). By default only organizations are kept, "
        "since search and leads only use organizations",
    )
    filters.add_argument(
        "--all-taxonomies",
        action="store_true",
        help="Skip taxonomy filtering entirely instead of reading public.taxonomies",
    )

    filters.add_argument(
        "--exclude-keywords",
        default=None,
        help="Comma-separated terms; a provider whose name contains any is not staged (case-insensitive)",
    )
    filters.add_argument(
        "--exclude-keywords-file",
        type=Path,
        default=None,
        help="Text file with one exclusion term per line (# comments allowed); combined with --exclude-keywords. "
        "Default: scripts/nppes_ingest/exclude_keywords.txt",
    )
    filters.add_argument(
        "--no-exclude-keywords",
        action="store_true",
        help="Do NOT apply the default exclusion keyword file (excluded providers will be re-imported)",
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

    after = parser.add_argument_group("after a refresh")
    after.add_argument(
        "--apply-exclusions",
        action="store_true",
        help="On its own: flag providers matching the exclusion keywords (catches renames since the last run); "
        "add --dry-run to only count. Runs automatically at the end of --apply / --apply-run",
    )
    after.add_argument(
        "--remove-excluded",
        action="store_true",
        help="On its own: preview the flagged providers that can be permanently deleted",
    )
    after.add_argument(
        "--yes-delete",
        action="store_true",
        help="With --remove-excluded: actually delete them. Irreversible; there is no archive",
    )
    after.add_argument(
        "--skip-exclusions",
        action="store_true",
        help="Don't flag excluded providers at the end of --apply / --apply-run",
    )
    after.add_argument(
        "--exclusion-batch-size",
        type=int,
        default=DEFAULT_EXCLUSION_BATCH_SIZE,
        help="Providers per flagging / deleting call",
    )

    plumbing = parser.add_argument_group("plumbing")
    plumbing.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="Rows per staging insert")
    plumbing.add_argument("--env-file", type=Path, help="dotenv file with SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    plumbing.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and report without creating a refresh run or writing staging (needs no credentials)",
    )
    plumbing.add_argument(
        "--skip-checksum",
        action="store_true",
        help="Skip SHA-256 checksumming of the source file (useful when reading over a slow network share)",
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


def load_exclude_keywords(inline: str | None, path: Path | None) -> tuple[str, ...] | None:
    """Merge --exclude-keywords and --exclude-keywords-file into one lowercase tuple."""
    terms: list[str] = []
    if inline:
        terms.extend(inline.split(","))
    if path is not None:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.lstrip().startswith("#"):
                terms.append(line)
    cleaned = tuple(dict.fromkeys(t.strip().lower() for t in terms if t.strip()))
    return cleaned or None


def resolve_exclude_keywords(args: argparse.Namespace, run_type: str | None):
    """The terms to use, and the file they came from (the default file unless opted out)."""
    keywords_file = args.exclude_keywords_file
    if keywords_file is None and not args.no_exclude_keywords and run_type != RUN_TYPE_DEACTIVATION:
        keywords_file = DEFAULT_EXCLUDE_KEYWORDS_FILE
    return load_exclude_keywords(args.exclude_keywords, keywords_file), keywords_file


def flag_excluded_after_apply(client: SupabaseClient, args: argparse.Namespace, run_type: str | None) -> None:
    """Last step of --apply / --apply-run: flag providers renamed into the keyword list."""
    if args.skip_exclusions or args.no_exclude_keywords or run_type == RUN_TYPE_DEACTIVATION:
        return
    terms, _ = resolve_exclude_keywords(args, run_type)
    if not terms:
        return
    # The refresh itself already succeeded; a failure here must not look like it didn't.
    try:
        run_apply_exclusions(client, terms, batch_size=args.exclusion_batch_size)
    except Exception as err:
        print(f"warning: the refresh is applied, but flagging excluded providers failed ({err}). "
              "Re-run with `python -m nppes_ingest --apply-exclusions`.", flush=True)
        return
    print("Next: `python -m nppes_ingest --remove-excluded` previews what can now be deleted.", flush=True)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.restart and not args.sync_run:
        print("error: --restart is only used with --sync-run", flush=True)
        return 2

    if args.match_registry:
        if args.sync_run or args.apply_run or args.recover_run or args.abort_run or args.source is not None:
            print("error: --match-registry is used on its own", flush=True)
            return 2
        try:
            client = SupabaseClient(load_supabase_config(args.env_file))
            return 1 if run_registry_match(client, max_bucket=args.match_max_bucket) is None else 0
        except (ConfigError, RuntimeError, ValueError) as err:
            print(f"error: {err}", flush=True)
            return 1

    if args.apply_exclusions or args.remove_excluded:
        if args.apply_exclusions and args.remove_excluded:
            print("error: choose --apply-exclusions or --remove-excluded, not both", flush=True)
            return 2
        if args.sync_run or args.apply_run or args.recover_run or args.abort_run or args.source is not None:
            print("error: --apply-exclusions / --remove-excluded are used on their own", flush=True)
            return 2
        if args.yes_delete and not args.remove_excluded:
            print("error: --yes-delete is only used with --remove-excluded", flush=True)
            return 2
        try:
            client = SupabaseClient(load_supabase_config(args.env_file))
            if args.remove_excluded:
                run_remove_excluded(client, confirmed=args.yes_delete, batch_size=args.exclusion_batch_size)
                return 0
            terms, _ = resolve_exclude_keywords(args, None)
            if not terms:
                print("error: no exclusion keywords found (see --exclude-keywords / --exclude-keywords-file)", flush=True)
                return 2
            result = run_apply_exclusions(client, terms, dry_run=args.dry_run, batch_size=args.exclusion_batch_size)
            return 1 if result is None else 0
        except (ConfigError, RuntimeError, ValueError, OSError) as err:
            print(f"error: {err}", flush=True)
            return 1

    if args.sync_run:
        if args.apply_run or args.recover_run or args.abort_run or args.source is not None:
            print("error: --sync-run is used on its own (it syncs an already applied run)", flush=True)
            return 2
        try:
            client = SupabaseClient(load_supabase_config(args.env_file))
            if run_lead_sync(client, args.sync_run, batch_size=args.apply_batch_size, restart=args.restart) is None:
                return 1
            return 0
        except (ConfigError, RuntimeError, ValueError) as err:
            print(f"error: {err}", flush=True)
            return 1

    if args.apply_run:
        if args.recover_run or args.abort_run or args.source is not None:
            print("error: --apply-run is used on its own (it applies an already staged run)", flush=True)
            return 2
        try:
            client = SupabaseClient(load_supabase_config(args.env_file))
            run_apply(client, args.apply_run, batch_size=args.apply_batch_size, sync_leads=not args.skip_lead_sync)
            if not args.skip_registry_match:
                run_registry_match(client, max_bucket=args.match_max_bucket)
            flag_excluded_after_apply(client, args, None)
            return 0
        except (ConfigError, RuntimeError, ValueError) as err:
            print(f"error: {err}", flush=True)
            return 1

    if args.recover_run or args.abort_run:
        if args.recover_run and args.abort_run:
            print("error: choose only one recovery command", flush=True)
            return 2
        if args.abort_run and not args.reason:
            print("error: --abort-run requires --reason", flush=True)
            return 2
        try:
            client = SupabaseClient(load_supabase_config(args.env_file))
            function = "finalize_nppes_staging" if args.recover_run else "abort_nppes_refresh"
            params = {"p_run_id": args.recover_run or args.abort_run}
            if args.abort_run:
                params["p_reason"] = args.reason
            print(client.rpc(function, params), flush=True)
            return 0
        except (ConfigError, RuntimeError) as err:
            print(f"error: {err}", flush=True)
            return 1

    if args.source is None or args.run_type is None:
        print("error: source and --run-type are required unless using a recovery command", flush=True)
        return 2

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

    # The team's exclusion list is on by default, so a monthly refresh can't
    # quietly re-import providers that were removed. A missing default file is an
    # error rather than a silent unfiltered run.
    try:
        exclude_keywords, keywords_file = resolve_exclude_keywords(args, args.run_type)
    except OSError as err:
        print(f"error: can't read the exclusion keywords ({err}). Pass --exclude-keywords-file, or --no-exclude-keywords to skip.", flush=True)
        return 2
    if exclude_keywords and args.run_type != RUN_TYPE_DEACTIVATION:
        print(f"Excluding providers whose name contains any of {len(exclude_keywords)} keywords"
              f"{f' (from {keywords_file})' if keywords_file else ''}.", flush=True)

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
        organizations_only=not args.include_individuals,
        exclude_keywords=exclude_keywords,
        skip_checksum=args.skip_checksum,
    )

    if args.apply and args.dry_run:
        print("error: --apply can't be combined with --dry-run", flush=True)
        return 2

    try:
        result = run_ingest(options, None if args.dry_run else client)
        if args.apply:
            run_apply(client, result.manifest.refresh_run_id, batch_size=args.apply_batch_size,
                      sync_leads=not args.skip_lead_sync)
            if not args.skip_registry_match:
                run_registry_match(client, max_bucket=args.match_max_bucket)
            flag_excluded_after_apply(client, args, args.run_type)
    except PermissionError as err:
        print(
            f"error: permission denied reading {err.filename or args.source} -- this Windows account can't open "
            "the file. Ask the share owner for read access, or copy the file somewhere you can read it.",
            flush=True,
        )
        return 1
    except (FileNotFoundError, ValueError, RuntimeError, OSError) as err:
        print(f"error: {err}", flush=True)
        return 1
    return 0


