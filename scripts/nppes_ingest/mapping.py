"""NPPES source headers -> `nppes_refresh_staging` columns.

The NPPES dissemination file has ~330 columns; we carry the ones the
identity-grouping and provider-change-tracking work actually compares, plus
enough context to investigate a row later. Column names on our side follow
the fakeNPI-compatible names already used by `npi_records`, so the eventual
staging -> `npi_records` apply step is close to a 1:1 copy.

Header lookup is case- and whitespace-insensitive, because NPPES has
shipped the same column under slightly different spacing across releases.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Mapping

from .normalize import (
    clean_text,
    date_to_iso,
    first_phone,
    normalize_name,
    normalize_postal_code,
    normalize_state,
    parse_date,
)

TAXONOMY_SLOTS = 15

# Canonical header -> the aliases seen across NPPES releases/exports.
HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "npi": ("NPI",),
    "entity_type_code": ("Entity Type Code",),
    "replacement_npi": ("Replacement NPI",),
    "organization_name": ("Provider Organization Name (Legal Business Name)",),
    "last_name": ("Provider Last Name (Legal Name)",),
    "first_name": ("Provider First Name",),
    "middle_name": ("Provider Middle Name",),
    "address_line1": ("Provider First Line Business Practice Location Address",),
    "address_line2": ("Provider Second Line Business Practice Location Address",),
    "address_city": ("Provider Business Practice Location Address City Name",),
    "address_state": ("Provider Business Practice Location Address State Name",),
    "address_postal_code": ("Provider Business Practice Location Address Postal Code",),
    "phone": ("Provider Business Practice Location Address Telephone Number",),
    "fax": ("Provider Business Practice Location Address Fax Number",),
    "authorizedofficial_lastname": ("Authorized Official Last Name",),
    "authorizedofficial_firstname": ("Authorized Official First Name",),
    "authorizedofficial_title": ("Authorized Official Title or Position",),
    "authorizedofficial_phone": ("Authorized Official Telephone Number",),
    "enumeration_date": ("Provider Enumeration Date",),
    "lastupdated": ("Last Update Date",),
    "deactivation_date": ("NPI Deactivation Date",),
    "reactivation_date": ("NPI Reactivation Date",),
    "certification_date": ("Certification Date",),
}

_NORMALIZE_HEADER_RE = re.compile(r"[^a-z0-9]+")


def _header_key(header: str) -> str:
    return _NORMALIZE_HEADER_RE.sub("", header.lower())


class HeaderIndex:
    """Case/spacing-insensitive lookup from a CSV's header row.

    Mirrors the lookup-by-label rule the Sheets-era code followed: never
    read a column by position, so an added or reordered source column can't
    silently shift every value by one.
    """

    def __init__(self, headers: list[str]) -> None:
        self._by_key: dict[str, str] = {}
        for header in headers:
            self._by_key.setdefault(_header_key(header), header)
        self.headers = headers

    def resolve(self, canonical: str) -> str | None:
        for alias in HEADER_ALIASES.get(canonical, (canonical,)):
            actual = self._by_key.get(_header_key(alias))
            if actual is not None:
                return actual
        return None

    def get(self, row: Mapping[str, Any], canonical: str) -> Any:
        actual = self.resolve(canonical)
        return row.get(actual) if actual is not None else None

    def taxonomy_columns(self) -> list[str]:
        """Actual header names for the taxonomy code slots that exist."""
        found: list[str] = []
        for slot in range(1, TAXONOMY_SLOTS + 1):
            actual = self._by_key.get(_header_key(f"Healthcare Provider Taxonomy Code_{slot}"))
            if actual is not None:
                found.append(actual)
        return found

    def primary_switch_columns(self) -> list[str | None]:
        return [
            self._by_key.get(_header_key(f"Healthcare Provider Primary Taxonomy Switch_{slot}"))
            for slot in range(1, TAXONOMY_SLOTS + 1)
        ]


@dataclass
class StagedProvider:
    """One normalized provider row, ready for `nppes_refresh_staging`."""

    npi: str
    source_row_number: int
    name: str | None = None
    normalized_name: str | None = None
    enumerationtype: str | None = None
    isorganization: bool | None = None
    status: str | None = None
    replacement_npi: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    address_city: str | None = None
    address_state: str | None = None
    address_postal_code: str | None = None
    phone: str | None = None
    fax: str | None = None
    taxonomy_code: str | None = None
    taxonomy_codes: list[str] = field(default_factory=list)
    authorizedofficial_firstname: str | None = None
    authorizedofficial_lastname: str | None = None
    authorizedofficial_title: str | None = None
    authorizedofficial_phone: str | None = None
    enumeration_date: str | None = None
    lastupdated: str | None = None
    deactivation_date: str | None = None
    reactivation_date: str | None = None
    certification_date: str | None = None

    def to_staging_row(self, refresh_run_id: str) -> dict[str, Any]:
        return {
            "refresh_run_id": refresh_run_id,
            "npi": self.npi,
            "source_row_number": self.source_row_number,
            "name": self.name,
            "normalized_name": self.normalized_name,
            "enumerationtype": self.enumerationtype,
            "isorganization": self.isorganization,
            "status": self.status,
            "replacement_npi": self.replacement_npi,
            "address_line1": self.address_line1,
            "address_line2": self.address_line2,
            "address_city": self.address_city,
            "address_state": self.address_state,
            "address_postal_code": self.address_postal_code,
            "phone": self.phone,
            "fax": self.fax,
            "taxonomy_code": self.taxonomy_code,
            "taxonomy_codes": self.taxonomy_codes,
            "authorizedofficial_firstname": self.authorizedofficial_firstname,
            "authorizedofficial_lastname": self.authorizedofficial_lastname,
            "authorizedofficial_title": self.authorizedofficial_title,
            "authorizedofficial_phone": self.authorizedofficial_phone,
            "enumeration_date": self.enumeration_date,
            "lastupdated": self.lastupdated,
            "deactivation_date": self.deactivation_date,
            "reactivation_date": self.reactivation_date,
            "certification_date": self.certification_date,
        }


def extract_taxonomy_codes(index: HeaderIndex, row: Mapping[str, Any]) -> tuple[str | None, list[str]]:
    """Return (primary code, all codes) for one source row.

    The primary is whichever slot has its "Primary Taxonomy Switch" set to
    Y; NPPES does not guarantee that is slot 1, so falling back to the first
    populated slot is the documented behaviour, not a shortcut.
    """
    codes: list[str] = []
    primary: str | None = None
    switch_columns = index.primary_switch_columns()
    for slot, column in enumerate(index.taxonomy_columns()):
        code = clean_text(row.get(column))
        if not code:
            continue
        code = code.upper()
        if code not in codes:
            codes.append(code)
        switch_column = switch_columns[slot] if slot < len(switch_columns) else None
        if primary is None and switch_column is not None:
            if (clean_text(row.get(switch_column)) or "").upper() == "Y":
                primary = code
    if primary is None and codes:
        primary = codes[0]
    return primary, codes


def _provider_name(index: HeaderIndex, row: Mapping[str, Any], is_organization: bool) -> str | None:
    if is_organization:
        organization = clean_text(index.get(row, "organization_name"))
        if organization:
            return organization
    parts = [clean_text(index.get(row, "first_name")), clean_text(index.get(row, "last_name"))]
    person = " ".join(part for part in parts if part)
    return person or clean_text(index.get(row, "organization_name"))


def map_provider_row(index: HeaderIndex, row: Mapping[str, Any], source_row_number: int) -> StagedProvider:
    """Map one full-dissemination / weekly-update row into staging shape."""
    entity_type = clean_text(index.get(row, "entity_type_code"))
    is_organization = entity_type == "2"
    deactivation = parse_date(index.get(row, "deactivation_date"))
    reactivation = parse_date(index.get(row, "reactivation_date"))
    # A reactivation after a deactivation means the NPI is live again --
    # comparing the dates is the only way to tell, since NPPES keeps both.
    deactivated = deactivation is not None and (reactivation is None or reactivation < deactivation)

    name = _provider_name(index, row, is_organization)
    primary_taxonomy, taxonomy_codes = extract_taxonomy_codes(index, row)

    return StagedProvider(
        npi=(clean_text(index.get(row, "npi")) or ""),
        source_row_number=source_row_number,
        name=name,
        normalized_name=normalize_name(name),
        enumerationtype=f"NPI-{entity_type}" if entity_type else None,
        isorganization=is_organization,
        status="deactivated" if deactivated else "active",
        replacement_npi=clean_text(index.get(row, "replacement_npi")),
        address_line1=clean_text(index.get(row, "address_line1")),
        address_line2=clean_text(index.get(row, "address_line2")),
        address_city=clean_text(index.get(row, "address_city")),
        address_state=normalize_state(index.get(row, "address_state")),
        address_postal_code=normalize_postal_code(index.get(row, "address_postal_code")),
        phone=first_phone(index.get(row, "phone")),
        fax=first_phone(index.get(row, "fax")),
        taxonomy_code=primary_taxonomy,
        taxonomy_codes=taxonomy_codes,
        authorizedofficial_firstname=clean_text(index.get(row, "authorizedofficial_firstname")),
        authorizedofficial_lastname=clean_text(index.get(row, "authorizedofficial_lastname")),
        authorizedofficial_title=clean_text(index.get(row, "authorizedofficial_title")),
        authorizedofficial_phone=first_phone(index.get(row, "authorizedofficial_phone")),
        enumeration_date=date_to_iso(parse_date(index.get(row, "enumeration_date"))),
        lastupdated=date_to_iso(parse_date(index.get(row, "lastupdated"))),
        deactivation_date=date_to_iso(deactivation),
        reactivation_date=date_to_iso(reactivation),
        certification_date=date_to_iso(parse_date(index.get(row, "certification_date"))),
    )


def map_deactivation_row(index: HeaderIndex, row: Mapping[str, Any], source_row_number: int) -> StagedProvider:
    """Map one deactivation-file row.

    The deactivation file carries only an NPI and a date, so everything else
    stays None. That matters downstream: the apply step must treat a None
    here as "this release says nothing about that field", never as "this
    field is now empty".
    """
    return StagedProvider(
        npi=(clean_text(index.get(row, "npi")) or ""),
        source_row_number=source_row_number,
        status="deactivated",
        deactivation_date=date_to_iso(parse_date(index.get(row, "deactivation_date"))),
    )
