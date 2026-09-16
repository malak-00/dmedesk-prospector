"""Apply a staged refresh run to npi_records, in batches.

The work itself happens in SQL (sql/007_nppes_refresh_lifecycle.sql):
`apply_nppes_refresh_batch` applies one short transaction's worth of staged
rows and marks them applied, and `finish_nppes_apply` marks the run applied
once nothing is left. This module only drives that loop and reports progress,
so an interrupted apply can simply be run again and continues where it
stopped.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

DEFAULT_APPLY_BATCH_SIZE = 1000
COUNTERS = ("processed", "inserted", "updated", "unchanged", "skipped", "changed_fields")


@dataclass
class ApplyResult:
    run_id: str
    batches: int = 0
    totals: dict[str, int] = field(default_factory=lambda: {key: 0 for key in COUNTERS})
    finish: dict[str, Any] | None = None


def run_apply(
    client: Any,
    run_id: str,
    *,
    batch_size: int = DEFAULT_APPLY_BATCH_SIZE,
    log: Callable[[str], None] = print,
    max_batches: int | None = None,
) -> ApplyResult:
    """Apply every remaining staged row of `run_id`, then finish the run."""
    if batch_size < 1:
        raise ValueError("batch size must be at least 1")

    result = ApplyResult(run_id=run_id)
    while True:
        if max_batches is not None and result.batches >= max_batches:
            raise RuntimeError(f"Stopped after {max_batches} batches with rows still remaining")
        batch = client.rpc("apply_nppes_refresh_batch", {"p_run_id": run_id, "p_batch_size": batch_size})
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
    return result
