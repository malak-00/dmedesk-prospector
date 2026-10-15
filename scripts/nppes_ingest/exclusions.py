"""Keep the exclusion keywords applied to npi_records after a refresh.

The monthly ingest already refuses to stage excluded providers, but a provider
that was renamed since the last run still sits in npi_records under its old
name. These helpers drive the two SQL functions that deal with that:

  * `apply_exclusion_keywords` (sql/042) flags providers whose name matches a
    keyword, hiding them from search. Reversible, and it never flags a provider
    a rep holds.
  * `remove_excluded_providers` (sql/044) permanently deletes flagged providers
    that have no lead, call, ownership event, claim request or shared group.
    Irreversible, so it is a preview unless explicitly confirmed.

Both are batched: each call is one short transaction, so an interrupted run can
simply be started again.
"""

from __future__ import annotations

from typing import Any, Callable, Sequence

from .apply import _is_missing_function

DEFAULT_EXCLUSION_BATCH_SIZE = 5000
DELETE_CONFIRM_PHRASE = "delete excluded providers"


def run_apply_exclusions(
    client: Any,
    terms: Sequence[str],
    *,
    dry_run: bool = False,
    batch_size: int = DEFAULT_EXCLUSION_BATCH_SIZE,
    log: Callable[[str], None] = print,
) -> dict[str, Any] | None:
    """Flag providers matching `terms` (and release ones whose term was dropped).

    Returns the last SQL result, or None if sql/042 isn't installed.
    """
    if not terms:
        log("No exclusion keywords given; nothing to flag.")
        return None

    def call(dry: bool) -> dict[str, Any]:
        result = client.rpc(
            "apply_exclusion_keywords",
            {"p_terms": list(terms), "p_dry_run": dry, "p_batch": batch_size},
        )
        if not isinstance(result, dict):
            raise RuntimeError(f"Unexpected apply_exclusion_keywords response: {result!r}")
        return result

    try:
        preview = call(True)
    except Exception as err:
        if _is_missing_function(err):
            log("Skipping exclusion flagging: apply_exclusion_keywords isn't installed. Run sql/042_exclusion_flag.sql first.")
            return None
        raise

    log(
        f"Exclusion keywords ({len(terms)}): {int(preview.get('to_exclude') or 0):,} provider(s) to flag, "
        f"{int(preview.get('skipped_rep_held') or 0):,} held by a rep (never flagged), "
        f"{int(preview.get('to_release') or 0):,} to release (term no longer listed)."
    )
    if dry_run:
        log("Dry run: nothing was changed.")
        return preview
    if not preview.get("to_exclude") and not preview.get("to_release"):
        log("Nothing to do.")
        return preview

    while True:
        result = call(False)
        log(
            f"  flagged {int(result.get('excluded_this_call') or 0):,}, "
            f"released {int(result.get('released_this_call') or 0):,} -- "
            f"{int(result.get('remaining_to_exclude') or 0):,} remaining"
        )
        if not result.get("remaining_to_exclude"):
            return result
        # An empty batch with work left would loop forever; stop and say so.
        if not result.get("excluded_this_call"):
            raise RuntimeError("apply_exclusion_keywords made no progress; stopping. Check the term list and re-run.")


def run_remove_excluded(
    client: Any,
    *,
    confirmed: bool = False,
    batch_size: int = DEFAULT_EXCLUSION_BATCH_SIZE,
    log: Callable[[str], None] = print,
) -> dict[str, Any] | None:
    """Preview, or (confirmed=True) permanently delete, flagged providers.

    Returns the last SQL result, or None if sql/044 isn't installed.
    """
    try:
        preview = client.rpc("remove_excluded_providers", {"p_dry_run": True})
    except Exception as err:
        if _is_missing_function(err):
            log("Skipping removal: remove_excluded_providers isn't installed. Run sql/044_remove_excluded_providers.sql first.")
            return None
        raise
    if not isinstance(preview, dict):
        raise RuntimeError(f"Unexpected remove_excluded_providers response: {preview!r}")

    removable = int(preview.get("removable_now") or 0)
    log(
        f"Flagged providers that can be deleted: {removable:,}. "
        f"Kept (lead, call, ownership, claim request or shared group): "
        f"{int(preview.get('kept_because_of_leads_or_groups') or 0):,}."
    )
    if not confirmed:
        log("Preview only. To delete them permanently (no undo), re-run with --yes-delete.")
        return preview
    if not removable:
        log("Nothing to delete.")
        return preview

    while True:
        result = client.rpc(
            "remove_excluded_providers",
            {"p_dry_run": False, "p_batch": batch_size, "p_confirm": DELETE_CONFIRM_PHRASE},
        )
        deleted = int(result.get("deleted_npi_records") or 0)
        log(f"  deleted {deleted:,} provider(s) -- {int(result.get('remaining') or 0):,} remaining")
        if not result.get("remaining"):
            log(
                "Done. In the SQL editor run `vacuum analyze` on npi_records, npi_identity_keys, "
                "npi_cms_enrichment and lead_group_members."
            )
            return result
        if not deleted:
            raise RuntimeError("remove_excluded_providers made no progress; stopping.")
