"""Rebuild registry-wide identity match candidates after an NPPES refresh.

The work happens in SQL (sql/030_registry_identity_matching.sql). This module
drives it in short calls so each stays under the PostgREST statement timeout:

  1. refresh_npi_identity_keys   -- batched by NPI; only rows whose keys changed are written
  2. start_registry_match_build  -- opens a build
  3. build_registry_match_shard  -- one call per shard; shards are independent and re-runnable
  4. finish_registry_match_build -- drops pairs this build no longer found and writes a summary

Admin merge/dismiss decisions live in identity_match_decisions and are never
touched, so a rebuild can't undo a decision. A database without sql/030 is
reported as skipped, not as a failure, so the ingest still completes.
"""

from __future__ import annotations

from typing import Any, Callable

DEFAULT_KEY_BATCH_SIZE = 20000
DEFAULT_SHARDS = 64
DEFAULT_MAX_BUCKET = 25


def _is_missing_function(err: Exception) -> bool:
    message = str(err)
    return "PGRST202" in message or "42883" in message or "Could not find the function" in message


def run_registry_match(
    client: Any,
    *,
    key_batch_size: int = DEFAULT_KEY_BATCH_SIZE,
    shards: int = DEFAULT_SHARDS,
    max_bucket: int = DEFAULT_MAX_BUCKET,
    log: Callable[[str], None] = print,
) -> dict[str, Any] | None:
    """Refresh identity keys, then rebuild the candidate pairs.

    Returns the build summary, or None when sql/030 isn't installed.
    """
    if key_batch_size < 1:
        raise ValueError("key batch size must be at least 1")
    if shards < 1:
        raise ValueError("shards must be at least 1")

    after = ""
    processed = 0
    written = 0
    batches = 0
    while True:
        try:
            batch = client.rpc("refresh_npi_identity_keys", {"p_after": after, "p_batch_size": key_batch_size})
        except Exception as err:
            if batches == 0 and _is_missing_function(err):
                log(
                    "Skipping registry matching: refresh_npi_identity_keys isn't installed. "
                    "Run sql/030_registry_identity_matching.sql, then run: python -m nppes_ingest --match-registry"
                )
                return None
            raise
        if not isinstance(batch, dict):
            raise RuntimeError(f"Unexpected identity key response: {batch!r}")
        batches += 1
        processed += int(batch.get("processed") or 0)
        written += int(batch.get("written") or 0)
        if batch.get("done"):
            break
        after = batch.get("last_npi") or ""
        if not after:
            raise RuntimeError("Identity key refresh returned no cursor but is not done")
        log(f"  identity keys: {processed:,} organization NPIs checked, {written:,} changed")
    log(f"Identity keys: {processed:,} organization NPIs checked, {written:,} added/changed/removed")

    build_id = client.rpc("start_registry_match_build", {"p_max_bucket": max_bucket})
    if not isinstance(build_id, str) or not build_id:
        raise RuntimeError(f"Unexpected build id: {build_id!r}")

    pairs_seen = 0
    for shard in range(shards):
        result = client.rpc("build_registry_match_shard", {"p_build": build_id, "p_shard": shard, "p_shards": shards})
        if not isinstance(result, dict):
            raise RuntimeError(f"Unexpected shard response: {result!r}")
        pairs_seen += int(result.get("pairs") or 0)
        if (shard + 1) % 8 == 0 or shard + 1 == shards:
            log(f"  match shards: {shard + 1}/{shards} done, {pairs_seen:,} pairs so far")

    summary = client.rpc("finish_registry_match_build", {"p_build": build_id})
    if not isinstance(summary, dict):
        raise RuntimeError(f"Unexpected build summary: {summary!r}")
    log(
        f"Registry matching: {int(summary.get('pairs') or 0):,} candidate pairs "
        f"({int(summary.get('new_pairs') or 0):,} new, {int(summary.get('removed_pairs') or 0):,} no longer match); "
        f"{int(summary.get('big_buckets') or 0):,} oversized key groups skipped. "
        "Review them in the registry_review_queue view."
    )
    return summary
