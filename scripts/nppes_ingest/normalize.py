"""Canonical value normalization.

Every comparison the refresh pipeline eventually makes -- staging vs
`npi_records` -- has to run on canonical values, or a formatting-only
change (a reformatted phone number, trailing whitespace, a case change)
would look like a real provider-data change and raise a false review alert.
Normalizing on the way *into* staging means the later compare step is a
plain equality test.

The phone rule matches the one the identity-grouping SQL already uses:
extract the FIRST valid 10-digit number from a mixed or multi-number cell.
"""

from __future__ import annotations

import re
from datetime import date, datetime

_WHITESPACE_RE = re.compile(r"\s+")
_NON_DIGIT_RE = re.compile(r"\D+")
_PUNCTUATION_RE = re.compile(r"[^A-Z0-9 ]+")

# NPPES dates are MM/DD/YYYY in the dissemination files, but exports and
# hand-edited fixtures show up as ISO too. Try the documented format first.
_DATE_FORMATS = ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%d-%b-%Y")


def clean_text(value: object) -> str | None:
    """Trim, collapse internal whitespace, and map empty to None."""
    if value is None:
        return None
    text = _WHITESPACE_RE.sub(" ", str(value)).strip()
    return text or None


def normalize_name(value: object) -> str | None:
    """Uppercase, punctuation-stripped identity text (for identity keys)."""
    text = clean_text(value)
    if text is None:
        return None
    stripped = _PUNCTUATION_RE.sub(" ", text.upper())
    stripped = _WHITESPACE_RE.sub(" ", stripped).strip()
    return stripped or None


def first_phone(*values: object) -> str | None:
    """First valid 10-digit phone number found across the given cells.

    A cell may hold several numbers ("555-1234 / 555-9999 ext 4"), a number
    with a country code, or junk. Digits are scanned left to right: a
    leading US country code `1` is dropped, and the first run of exactly 10
    usable digits wins. Returns the bare 10 digits, or None.
    """
    for value in values:
        text = clean_text(value)
        if text is None:
            continue
        for chunk in re.findall(r"\d[\d\s().-]*", text):
            digits = _NON_DIGIT_RE.sub("", chunk)
            if len(digits) == 11 and digits.startswith("1"):
                digits = digits[1:]
            if len(digits) >= 10:
                candidate = digits[:10]
                # A US area code never starts with 0 or 1; that filter drops
                # ZIP codes and other numeric noise that happen to be long.
                if candidate[0] not in "01":
                    return candidate
    return None


def normalize_postal_code(value: object) -> str | None:
    """NPPES stores ZIP+4 unpunctuated; keep 5 or 9 digits, hyphenate ZIP+4."""
    text = clean_text(value)
    if text is None:
        return None
    digits = _NON_DIGIT_RE.sub("", text)
    if len(digits) == 9:
        return f"{digits[:5]}-{digits[5:]}"
    if len(digits) >= 5:
        return digits[:5]
    return digits or None


def normalize_state(value: object) -> str | None:
    """Two-letter uppercase state code, or None."""
    text = clean_text(value)
    if text is None:
        return None
    upper = text.upper()
    return upper if len(upper) == 2 else upper[:2] or None


def parse_date(value: object) -> date | None:
    """Parse an NPPES date cell into a real date, or None."""
    text = clean_text(value)
    if text is None:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def date_to_iso(value: date | None) -> str | None:
    return value.isoformat() if value is not None else None


def parse_int(value: object) -> int | None:
    text = clean_text(value)
    if text is None:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None
