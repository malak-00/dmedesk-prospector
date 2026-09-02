"""Enabled taxonomy codes, read from the database rather than hardcoded.

The old standalone filter script carried its own copy of the taxonomy list,
which drifted from the `taxonomies` table the app's search form actually
uses. Reading the table means a taxonomy enabled in the admin UI is
automatically in scope for the next import, with no second place to update.
"""

from __future__ import annotations

from .supabase_rest import SupabaseClient, SupabaseError

TAXONOMIES_TABLE = "taxonomies"


class TaxonomyError(RuntimeError):
    """Raised when the enabled-taxonomy set cannot be established."""


def fetch_enabled_taxonomy_codes(client: SupabaseClient) -> frozenset[str]:
    """Codes from `public.taxonomies` where enabled is true."""
    try:
        rows = client.select(TAXONOMIES_TABLE, columns="code,enabled", filters={"enabled": "is.true"})
    except SupabaseError as err:  # pragma: no cover - network failure path
        raise TaxonomyError(f"Could not read enabled taxonomies: {err}") from err

    codes = {str(row.get("code") or "").strip().upper() for row in rows}
    codes.discard("")
    if not codes:
        raise TaxonomyError(
            "No enabled taxonomies found in public.taxonomies. Enable at least one, "
            "or pass --taxonomy-codes / --all-taxonomies to be explicit about the filter."
        )
    return frozenset(codes)


def parse_taxonomy_codes(values: list[str]) -> frozenset[str]:
    """Normalize a comma/space separated CLI taxonomy list."""
    codes: set[str] = set()
    for value in values:
        for part in str(value).replace(",", " ").split():
            cleaned = part.strip().upper()
            if cleaned:
                codes.add(cleaned)
    return frozenset(codes)
