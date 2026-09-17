"""Apply a staged refresh run to npi_records, in batches.

The work itself happens in SQL (sql/007_nppes_refresh_lifecycle.sql):
`apply_nppes_refresh_batch` applies one short transaction's worth of staged
rows and marks them applied, and `finish_nppes_apply` marks the run applied
once nothing is left. This module only drives that loop and reports progress,
so an interrupted apply can simply be run again and continues where it
stopped.

Once npi_records is up to date, `apply_provider_changes_to_leads`
(sql/015_provider_change_alerts.sql) does the second half: it refreshes the
provider-owned snapshot on claimed leads and raises a review alert for each
lead whose provider changed in a way its rep needs to know about. It is
batched and resumable in the same way. A release that has not had sql/015
installed yet still applies -- the sync is reported as skipped, and running
the apply again later picks it up, since nothing about it depends on the
staging rows.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

DEFAULT_APPLY_BATCH_SIZE = 500
DEFAULT_LEAD_SYNC_BATCH_SIZE = 500
COUNTERS = ("processed", "inserted", "updated", "unchanged", "skipped", "changed_fields")
LEAD_SYNC_COUNTERS = ("processed", "leads_updated", "alerts")


@dataclass
class ApplyResult:
    run_id: str
    batches: int = 0
    totals: dict[str, int] = field(default_factory=lambda: {key: 0 for key in COUNTERS})
    finish: dict[str, Any] | None = None
    lead_sync: dict[str, int] | None = None  # None when sql/015 isn't installed


def _is_missing_function(err: Exception) -> bool:
    """PostgREST answers PGRST202 for a function it can't find; Postgres 42883."""
    message = str(err)
    return "PGRST202" in message or "42883" in message or "Could not find the function" in message


def run_lead_sync(
    client: Any,
    run_id: str,
    *,
    batch_size: int = DEFAULT_LEAD_SYNC_BATCH_SIZE,
    log: Callable[[str], None] = print,
) -> dict[str, int] | None:
    """Refresh claimed leads from the applied release and raise change alerts.

    Returns the totals, or None when sql/015 has not been installed.
    """
    totals = {key: 0 for key in LEAD_SYNC_COUNTERS}
    batches = 0
    while True:
        try:
            batch = client.rpc("apply_provider_changes_to_leads", {"p_run_id": run_id, "p_batch_size": batch_size})
        except Exception as err:
            if batches == 0 and _is_missing_function(err):
                log(
                    "Skipping the claimed-lead sync: apply_provider_changes_to_leads isn't installed. "
                    "Run sql/015_provider_change_alerts.sql, then re-run this command with "
                    f"--apply-run {run_id} to pick it up."
                )
                return None
            raise
        if not isinstance(batch, dict):
            raise RuntimeError(f"Unexpected lead sync response: {batch!r}")
        batches += 1
        for key in LEAD_SYNC_COUNTERS:
            totals[key] += int(batch.get(key) or 0)
        if batch.get("done"):
            break
        log(
            f"  lead sync batch {batches}: {int(batch.get('processed') or 0):,} NPIs, "
            f"{int(batch.get('alerts') or 0):,} alerts -- {int(batch.get('remaining') or 0):,} remaining"
        )

    log(
        f"Claimed leads: {totals['leads_updated']:,} refreshed from the release, "
        f"{totals['alerts']:,} change alert(s) raised for their owners"
    )
    return totals


def run_apply(
    client: Any,
    run_id: str,
    *,
    batch_size: int = DEFAULT_APPLY_BATCH_SIZE,
    log: Callable[[str], None] = print,
    max_batches: int | None = None,
    sync_leads: bool = True,
) -> ApplyResult:
    """Apply every remaining staged row of `run_id`, then finish the run."""
    if batch_size < 1:
        raise ValueError("batch size must be at least 1")

    result = ApplyResult(run_id=run_id)
    current_batch_size = batch_size
    while True:
        if max_batches is not None and result.batches >= max_batches:
            raise RuntimeError(f"Stopped after {max_batches} batches with rows still remaining")
        try:
            batch = client.rpc("apply_nppes_refresh_batch", {"p_run_id": run_id, "p_batch_size": current_batch_size})
        except Exception as err:
            err_msg = str(err).lower()
            if ("statement timeout" in err_msg or "57014" in err_msg) and current_batch_size > 50:
                new_size = max(current_batch_size // 2, 50)
                log(f"  statement timeout with batch size {current_batch_size}; reducing to {new_size} and retrying...")
                current_batch_size = new_size
                continue
            raise
        if not isinstance(batch, dict):
            raise RuntimeError(f"Unexpected apply response: {batch!r}")
        result.batches += 1
        for key in COUNTERS:
            result.totals[key] += int(batch.get(key) or 0)
        remaining = int(batch.get("remaining") or 0)
        log(
            f"  batch {result.batches}: {int(batch.get('processed') or 0):,} rows "
            f"(+{int(batch.get('inserted') or 0):,} new, {int(batch.get('updated') or 0):,} updated, "
            f"{int(batch.get('changed_fields') or 0):,} field changes) -- {remaining:,} remaining"
        )
        if remaining == 0:
            break

    result.finish = client.rpc("finish_nppes_apply", {"p_run_id": run_id})
    totals = result.totals
    log(
        f"Applied run {run_id}: {totals['inserted']:,} new providers, {totals['updated']:,} updated, "
        f"{totals['unchanged']:,} unchanged, {totals['skipped']:,} skipped, "
        f"{totals['changed_fields']:,} field changes recorded in provider_field_history"
    )

    if sync_leads:
        result.lead_sync = run_lead_sync(client, run_id, log=log)
    return result
