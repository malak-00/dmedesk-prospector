"""Tests for the NPPES ingestion CLI.

Run from the repository root:

    python3 -m unittest discover -s scripts/tests -t scripts
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nppes_ingest import normalize, validate  # noqa: E402
from nppes_ingest.ingest import (  # noqa: E402
    RUN_TYPE_DEACTIVATION,
    RUN_TYPE_MONTHLY_FULL,
    IngestOptions,
    read_source_rows,
    run_ingest,
)
from nppes_ingest.mapping import HeaderIndex, map_provider_row  # noqa: E402
from nppes_ingest.validate import (  # noqa: E402
    REASON_BAD_NPI_CHECKSUM,
    REASON_DUPLICATE_NPI,
    REASON_MISSING_NAME,
    REASON_TAXONOMY_FILTERED,
    RowCountError,
    check_expected_row_count,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SAMPLE = FIXTURES / "nppes_sample.csv"
DEACTIVATION_SAMPLE = FIXTURES / "nppes_deactivation_sample.csv"
DME_TAXONOMY = frozenset({"332B00000X"})


def quiet(_message: str) -> None:
    """Swallow CLI progress output during tests."""


class FakeSupabaseClient:
    """Records what would have been written, so staging can be asserted on."""

    def __init__(self, *, fail_on_insert_batch: int | None = None) -> None:
        self.runs: list[dict] = []
        self.staged: list[dict] = []
        self.updates: list[tuple[dict, dict]] = []
        self.deletes: list[dict] = []
        self._insert_calls = 0
        self._fail_on_insert_batch = fail_on_insert_batch

    def insert(self, table: str, rows, *, returning: bool = False):
        if table == "refresh_runs":
            self.runs.append(rows[0])
            return [{"id": "00000000-0000-4000-8000-000000000001"}]
        self._insert_calls += 1
        if self._fail_on_insert_batch is not None and self._insert_calls == self._fail_on_insert_batch:
            raise RuntimeError("simulated staging failure")
        self.staged.extend(rows)
        return []

    def update(self, table: str, filters, values) -> None:
        self.updates.append((filters, values))

    def delete(self, table: str, filters) -> None:
        self.deletes.append(filters)


class NpiValidationTests(unittest.TestCase):
    def test_accepts_real_npis(self) -> None:
        for npi in ("1881462752", "1548921265", "1831477868", "1598747552", "1891506093"):
            self.assertTrue(validate.is_valid_npi(npi), npi)

    def test_rejects_bad_check_digit_and_shape(self) -> None:
        for npi in ("1881462725", "1234567890", "188146275", "18814627XX", ""):
            self.assertFalse(validate.is_valid_npi(npi), npi)


class NormalizationTests(unittest.TestCase):
    def test_first_phone_takes_first_valid_ten_digits(self) -> None:
        self.assertEqual(normalize.first_phone("858-665-2120 / 858-665-0000"), "8586652120")
        self.assertEqual(normalize.first_phone("1-858-665-2120"), "8586652120")
        self.assertEqual(normalize.first_phone("(858) 665-2120 ext 4"), "8586652120")

    def test_first_phone_falls_through_to_later_values(self) -> None:
        self.assertEqual(normalize.first_phone("ext 44", "2035550147"), "2035550147")

    def test_first_phone_rejects_non_phone_numerics(self) -> None:
        self.assertIsNone(normalize.first_phone("92121"))
        self.assertIsNone(normalize.first_phone(""))
        self.assertIsNone(normalize.first_phone(None))

    def test_identity_text_is_punctuation_free_and_uppercased(self) -> None:
        self.assertEqual(normalize.normalize_name(" Genome  Insight, Inc. "), "GENOME INSIGHT INC")

    def test_dates_and_postal_codes(self) -> None:
        self.assertEqual(normalize.date_to_iso(normalize.parse_date("07/06/2026")), "2026-07-06")
        self.assertEqual(normalize.date_to_iso(normalize.parse_date("2026-07-06")), "2026-07-06")
        self.assertIsNone(normalize.parse_date("not a date"))
        self.assertEqual(normalize.normalize_postal_code("921211234"), "92121-1234")
        self.assertEqual(normalize.normalize_postal_code("23434"), "23434")


class MappingTests(unittest.TestCase):
    def _first_row(self) -> tuple[HeaderIndex, dict, int]:
        for number, row, index in read_source_rows(SAMPLE):
            return index, row, number
        raise AssertionError("fixture is empty")

    def test_maps_organization_row(self) -> None:
        index, row, number = self._first_row()
        provider = map_provider_row(index, row, number)
        self.assertEqual(provider.npi, "1881462752")
        self.assertEqual(provider.name, "INOCRAS INC")
        self.assertEqual(provider.normalized_name, "INOCRAS INC")
        self.assertTrue(provider.isorganization)
        self.assertEqual(provider.enumerationtype, "NPI-2")
        self.assertEqual(provider.address_state, "CA")
        self.assertEqual(provider.address_postal_code, "92121-1234")
        self.assertEqual(provider.phone, "8586652120")
        self.assertEqual(provider.authorizedofficial_phone, "8586652120")
        self.assertEqual(provider.lastupdated, "2026-07-06")
        self.assertEqual(provider.status, "active")

    def test_primary_taxonomy_follows_the_switch_not_slot_order(self) -> None:
        index, row, number = self._first_row()
        provider = map_provider_row(index, row, number)
        self.assertEqual(provider.taxonomy_code, "332B00000X")
        self.assertEqual(provider.taxonomy_codes, ["291U00000X", "332B00000X"])

    def test_deactivation_before_reactivation_still_reads_as_deactivated(self) -> None:
        rows = {number: (index, row) for number, row, index in read_source_rows(SAMPLE)}
        index, row = rows[4]  # ADVANCED HOME MEDICAL SUPPLIES INC.
        provider = map_provider_row(index, row, 4)
        self.assertEqual(provider.status, "deactivated")
        self.assertEqual(provider.deactivation_date, "2026-06-01")

    def test_individual_provider_name_comes_from_person_fields(self) -> None:
        rows = {number: (index, row) for number, row, index in read_source_rows(SAMPLE)}
        index, row = rows[5]
        provider = map_provider_row(index, row, 5)
        self.assertEqual(provider.name, "RICK NELSON")
        self.assertFalse(provider.isorganization)

    def test_header_lookup_is_spacing_and_case_insensitive(self) -> None:
        index = HeaderIndex(["  npi  ", "entity type code"])
        self.assertEqual(index.resolve("npi"), "  npi  ")
        self.assertEqual(index.resolve("entity_type_code"), "entity type code")


class RowCountGuardTests(unittest.TestCase):
    def test_within_tolerance_passes(self) -> None:
        check_expected_row_count(9800, 10000, 5.0)

    def test_outside_tolerance_raises(self) -> None:
        with self.assertRaises(RowCountError):
            check_expected_row_count(4000, 10000, 5.0)

    def test_no_expectation_is_a_no_op(self) -> None:
        check_expected_row_count(1, None, 5.0)


class IngestRunTests(unittest.TestCase):
    def _options(self, tmp: str, **overrides) -> IngestOptions:
        defaults = dict(
            source_path=SAMPLE,
            run_type=RUN_TYPE_MONTHLY_FULL,
            output_dir=Path(tmp),
            taxonomy_codes=DME_TAXONOMY,
            label="test-run",
        )
        defaults.update(overrides)
        return IngestOptions(**defaults)

    def test_stages_only_valid_in_scope_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeSupabaseClient()
            result = run_ingest(self._options(tmp), client, log=quiet)

            staged_npis = [row["npi"] for row in client.staged]
            self.assertEqual(staged_npis, ["1881462752", "1598747552", "1831477868"])
            self.assertEqual(result.manifest.status, "staged")
            self.assertEqual(result.manifest.staged_rows, 3)

            reasons = result.manifest.rejections_by_reason
            self.assertEqual(reasons.get(REASON_TAXONOMY_FILTERED), 1)  # the VA podiatry row
            self.assertEqual(reasons.get(REASON_DUPLICATE_NPI), 1)
            self.assertEqual(reasons.get(REASON_BAD_NPI_CHECKSUM), 1)
            self.assertEqual(reasons.get(REASON_MISSING_NAME), 1)

    def test_every_staged_row_carries_the_refresh_run_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeSupabaseClient()
            run_ingest(self._options(tmp), client, log=quiet)
            run_ids = {row["refresh_run_id"] for row in client.staged}
            self.assertEqual(run_ids, {"00000000-0000-4000-8000-000000000001"})

    def test_state_filter_narrows_the_release(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeSupabaseClient()
            run_ingest(self._options(tmp, states=frozenset({"CT"})), client, log=quiet)
            self.assertEqual([row["npi"] for row in client.staged], ["1598747552"])

    def test_manifest_and_rejects_are_written(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeSupabaseClient()
            result = run_ingest(self._options(tmp), client, log=quiet)

            self.assertTrue(result.manifest_path.is_file())
            manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["run_type"], RUN_TYPE_MONTHLY_FULL)
            self.assertEqual(len(manifest["source_checksum"]), 64)
            self.assertEqual(manifest["source_rows"], 7)
            self.assertEqual(manifest["accepted_rows"], 3)
            self.assertEqual(manifest["rejected_rows"], 4)

            self.assertIsNotNone(result.rejects_path)
            rejects = result.rejects_path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(rejects[0], "source_row_number,npi,reason,detail")
            self.assertEqual(len(rejects), 5)

    def test_dry_run_writes_nothing_to_supabase(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = run_ingest(self._options(tmp, dry_run=True), None, log=quiet)
            self.assertEqual(result.manifest.status, "dry-run")
            self.assertEqual(result.manifest.staged_rows, 0)
            self.assertIsNone(result.manifest.refresh_run_id)

    def test_failed_staging_is_rolled_back_and_marked_failed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeSupabaseClient(fail_on_insert_batch=1)
            with self.assertRaises(RuntimeError):
                run_ingest(self._options(tmp, batch_size=1), client, log=quiet)

            self.assertEqual(client.deletes, [{"refresh_run_id": "eq.00000000-0000-4000-8000-000000000001"}])
            self.assertTrue(any(values.get("status") == "failed" for _filters, values in client.updates))

    def test_truncated_release_is_refused_before_staging(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeSupabaseClient()
            with self.assertRaises(RuntimeError):
                run_ingest(self._options(tmp, expect_rows=10000), client, log=quiet)
            self.assertEqual(client.runs, [])
            self.assertEqual(client.staged, [])

    def test_deactivation_file_stages_npi_and_date_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeSupabaseClient()
            result = run_ingest(
                self._options(
                    tmp,
                    source_path=DEACTIVATION_SAMPLE,
                    run_type=RUN_TYPE_DEACTIVATION,
                    taxonomy_codes=None,
                ),
                client,
                log=quiet,
            )
            self.assertEqual([row["npi"] for row in client.staged], ["1598747552", "1881462752"])
            self.assertTrue(all(row["status"] == "deactivated" for row in client.staged))
            self.assertTrue(all(row["name"] is None for row in client.staged))
            self.assertEqual(result.manifest.rejections_by_reason.get(REASON_BAD_NPI_CHECKSUM), 1)

    def test_run_type_and_missing_file_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                run_ingest(self._options(tmp, run_type="nonsense"), FakeSupabaseClient(), log=quiet)
            with self.assertRaises(FileNotFoundError):
                run_ingest(self._options(tmp, source_path=Path(tmp) / "missing.csv"), FakeSupabaseClient(), log=quiet)


if __name__ == "__main__":
    unittest.main()
