"""Row-level and run-level validation.

Nothing invalid reaches staging. Every rejected row keeps its source row
number and a machine-readable reason so the rejects report is actually
investigable rather than just a count.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .mapping import StagedProvider

# Reason codes -- stable strings, safe to group/count on in a report.
REASON_MISSING_NPI = "missing_npi"
REASON_BAD_NPI_FORMAT = "bad_npi_format"
REASON_BAD_NPI_CHECKSUM = "bad_npi_checksum"
REASON_DUPLICATE_NPI = "duplicate_npi_in_release"
REASON_MISSING_NAME = "missing_name"
REASON_STATE_FILTERED = "state_not_selected"
REASON_TAXONOMY_FILTERED = "taxonomy_not_enabled"


@dataclass(frozen=True)
class Rejection:
    """One rejected source row."""

    source_row_number: int
    npi: str
    reason: str
    detail: str = ""


def is_valid_npi(npi: str) -> bool:
    """Validate an NPI against the Luhn check digit CMS actually uses.

    An NPI is 10 digits: 9 identifier digits plus a check digit computed
    over the constant prefix 80840 (the NPPES issuer identifier) prepended
    to the first 9. A plain "is it 10 digits" test lets transposition typos
    through, which then create phantom providers that never match anything.
    """
    if len(npi) != 10 or not npi.isdigit():
        return False
    payload = "80840" + npi[:9]
    total = 0
    # Double every second digit counting from the right of the payload.
    for offset, char in enumerate(reversed(payload)):
        digit = int(char)
        if offset % 2 == 0:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    check_digit = (10 - (total % 10)) % 10
    return check_digit == int(npi[9])


class RowValidator:
    """Applies row filters and validity rules, tracking duplicates.

    Filters (state, taxonomy) are recorded as rejections with their own
    reason codes rather than silently dropped, so the manifest can show
    "12,000 rows filtered out by state" separately from "3 rows were
    malformed" -- those two numbers mean very different things when a
    release looks unexpectedly small.
    """

    def __init__(
        self,
        *,
        states: frozenset[str] | None = None,
        taxonomy_codes: frozenset[str] | None = None,
        require_name: bool = True,
    ) -> None:
        self.states = states
        self.taxonomy_codes = taxonomy_codes
        self.require_name = require_name
        self._seen_npis: dict[str, int] = {}

    def check(self, provider: StagedProvider) -> Rejection | None:
        """Return a Rejection if the row must not be staged, else None."""
        npi = provider.npi
        if not npi:
            return Rejection(provider.source_row_number, "", REASON_MISSING_NPI)
        if len(npi) != 10 or not npi.isdigit():
            return Rejection(provider.source_row_number, npi, REASON_BAD_NPI_FORMAT, "expected 10 digits")
        if not is_valid_npi(npi):
            return Rejection(provider.source_row_number, npi, REASON_BAD_NPI_CHECKSUM, "check digit does not match")

        first_seen = self._seen_npis.get(npi)
        if first_seen is not None:
            return Rejection(
                provider.source_row_number, npi, REASON_DUPLICATE_NPI, f"first seen at source row {first_seen}"
            )

        if self.require_name and not provider.name:
            return Rejection(provider.source_row_number, npi, REASON_MISSING_NAME)

        if self.states is not None and (provider.address_state or "") not in self.states:
            return Rejection(
                provider.source_row_number, npi, REASON_STATE_FILTERED, provider.address_state or "(no state)"
            )

        if self.taxonomy_codes is not None:
            if not set(provider.taxonomy_codes) & self.taxonomy_codes:
                return Rejection(
                    provider.source_row_number,
                    npi,
                    REASON_TAXONOMY_FILTERED,
                    ",".join(provider.taxonomy_codes) or "(no taxonomy)",
                )

        self._seen_npis[npi] = provider.source_row_number
        return None

    @property
    def accepted_npi_count(self) -> int:
        return len(self._seen_npis)


class RowCountError(RuntimeError):
    """Raised when a release's size is outside the approved range."""


def check_expected_row_count(actual: int, expected: int | None, tolerance_percent: float) -> None:
    """Guard against a truncated or wrong source file.

    A partial NPPES release that looks structurally fine is the dangerous
    case: staging it and applying it would read as "thousands of providers
    changed" rather than "the download was cut short".
    """
    if expected is None:
        return
    if expected <= 0:
        raise RowCountError(f"--expect-rows must be positive, got {expected}")
    allowed = abs(expected) * (tolerance_percent / 100.0)
    if abs(actual - expected) > allowed:
        raise RowCountError(
            f"source row count {actual:,} is outside the expected {expected:,} "
            f"+/- {tolerance_percent}% ({allowed:,.0f} rows). "
            "Re-download the release, or pass --expect-rows/--row-count-tolerance deliberately."
        )


def summarize_rejections(rejections: Iterable[Rejection]) -> dict[str, int]:
    """Count rejections by reason code, for the manifest."""
    counts: dict[str, int] = {}
    for rejection in rejections:
        counts[rejection.reason] = counts.get(rejection.reason, 0) + 1
    return counts
