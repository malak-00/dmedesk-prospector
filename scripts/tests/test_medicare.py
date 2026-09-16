"""Tests for the CMS DMEPOS by-Supplier Medicare loader.

Run from the repository root:

    python -m unittest discover -s scripts/tests -t scripts
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
TEST_TMP = Path(os.environ.get("NPPES_TEST_TMP", r"C:\\tmp\\dmedesk-nppes-tests"))
TEST_TMP.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(TEST_TMP)

from nppes_ingest import medicare  # noqa: E402
from nppes_ingest.medicare import (  # noqa: E402
    CATALOG_URL,
    DEFAULT_DATASET_ID,
    MedicareOptions,
    discover_latest_dataset,
    run_medicare_refresh,
)

OLD_ID = "7bb52a09-9eba-43f9-b7ec-57f65fbbc86c"
NEW_ID = "a2d56d3f-3531-4315-9d87-e29986516b41"
DUP_ID = "4c6cfc68-a149-4bfe-b934-db2b92d0f360"

CATALOG = {
    "dataset": [
        {"title": "Medicare Durable Medical Equipment, Devices & Supplies - by Supplier and Service", "distribution": [
            {"format": "API", "temporal": "2030-01-01/2030-12-31", "accessURL": "https://data.cms.gov/data-api/v1/dataset/00000000-0000-0000-0000-000000000000/data"}]},
        {"title": "Medicare Durable Medical Equipment, Devices & Supplies - by Supplier", "distribution": [
            {"title": "... : 2024-01-01", "format": "API", "temporal": "2024-01-01/2024-12-31", "accessURL": f"https://data.cms.gov/data-api/v1/dataset/{NEW_ID}/data"},
            {"title": "... : 2024-01-01", "format": "CSV", "temporal": "2024-01-01/2024-12-31", "downloadURL": "https://data.cms.gov/sites/default/files/x.csv"},
            {"title": "... : 2024-01-01", "format": "API", "temporal": "2024-01-01/2024-12-31", "accessURL": f"https://data.cms.gov/data-api/v1/dataset/{DUP_ID}/data"},
            {"title": "... : 2023-01-01", "format": "API", "temporal": "2023-01-01/2023-12-31", "accessURL": f"https://data.cms.gov/data-api/v1/dataset/{OLD_ID}/data"},
        ]},
    ]
}

VALID_NPIS = ["1881462752", "1598747552", "1831477868"]


def quiet(_message: str) -> None:
    pass


def make_rows():
    return [
        {"Suplr_NPI": VALID_NPIS[0], "Tot_Suplr_Clms": "244", "Tot_Suplr_Srvcs": "256", "Tot_Suplr_Benes": "238", "Suplr_Mdcr_Pymt_Amt": "48799.37", "Suplr_Mdcr_Alowd_Amt": "63465.4"},
        {"Suplr_NPI": VALID_NPIS[1], "Tot_Suplr_Clms": "1,200", "Tot_Suplr_Srvcs": "", "Tot_Suplr_Benes": "90", "Suplr_Mdcr_Pymt_Amt": "10", "Suplr_Mdcr_Alowd_Amt": "12"},
        {"Suplr_NPI": "1881462725", "Tot_Suplr_Clms": "5"},  # bad check digit
        {"Suplr_NPI": VALID_NPIS[2], "Tot_Suplr_Clms": "7"},
        {"Suplr_NPI": VALID_NPIS[0], "Tot_Suplr_Clms": "999"},  # duplicate
    ]


class FakeCms:
    def __init__(self, rows, *, reported=None, catalog=CATALOG, catalog_fails=False):
        self.rows = rows
        self.reported = len(rows) if reported is None else reported
        self.catalog = catalog
        self.catalog_fails = catalog_fails
        self.urls: list[str] = []

    def __call__(self, url: str):
        self.urls.append(url)
        if url == CATALOG_URL:
            if self.catalog_fails:
                raise RuntimeError("catalog down")
            return self.catalog
        if url.endswith("/data-viewer/stats"):
            return {"data": {"found_rows": self.reported, "total_rows": self.reported}}
        params = dict(part.split("=") for part in url.split("?", 1)[1].split("&"))
        size, offset = int(params["size"]), int(params["offset"])
        return self.rows[offset:offset + size]


class FakeClient:
    def __init__(self, *, fail_on_insert_batch=None):
        self.runs, self.staged, self.updates, self.deletes, self.rpcs = [], [], [], [], []
        self.fail_on_insert_batch = fail_on_insert_batch
        self._inserts = 0

    def insert(self, table, rows, *, returning=False):
        if table == "refresh_runs":
            self.runs.append(rows[0])
            return [{"id": "run-1"}]
        self._inserts += 1
        if self.fail_on_insert_batch == self._inserts:
            raise RuntimeError("simulated staging failure")
        self.staged.extend(rows)
        return []

    def update(self, table, filters, values):
        self.updates.append((filters, values))

    def delete(self, table, filters):
        self.deletes.append((table, filters))

    def rpc(self, function, params=None):
        self.rpcs.append((function, params))
        return {"status": "applied", "inserted": 3}


class DiscoveryTests(unittest.TestCase):
    def test_picks_newest_year_of_the_exact_dataset_first_listed_on_ties(self):
        self.assertEqual(discover_latest_dataset(lambda url: CATALOG)[0], NEW_ID)

    def test_missing_dataset_or_catalog_failure_returns_none(self):
        self.assertIsNone(discover_latest_dataset(lambda url: {"dataset": []}))

        def boom(url):
            raise RuntimeError("down")

        self.assertIsNone(discover_latest_dataset(boom))


class MedicareRunTests(unittest.TestCase):
    def _options(self, tmp, **overrides):
        values = dict(output_dir=Path(tmp), page_size=2, batch_size=2, label="medicare-test")
        values.update(overrides)
        return MedicareOptions(**values)

    def test_stages_valid_rows_across_pages_and_marks_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            client, cms = FakeClient(), FakeCms(make_rows())
            result = run_medicare_refresh(self._options(tmp), client, fetch_json=cms, log=quiet)
            self.assertEqual(result.dataset_id, NEW_ID)
            self.assertEqual([row["npi"] for row in client.staged], VALID_NPIS)
            self.assertTrue(all(row["refresh_run_id"] == "run-1" for row in client.staged))
            self.assertEqual(client.staged[1]["total_claims"], 1200.0)
            self.assertIsNone(client.staged[1]["total_services"])
            self.assertEqual(result.rejected, {"bad_npi": 1, "duplicate_npi": 1})
            self.assertEqual(client.runs[0]["source"], "medicare")
            final = client.updates[-1][1]
            self.assertEqual(final["row_count"], 3)
            self.assertEqual(final["metadata"]["staging_state"], "complete")
            self.assertEqual(len(final["metadata"]["content_checksum"]), 64)
            self.assertEqual(client.rpcs, [])
            self.assertEqual(json.loads(result.manifest_path.read_text())["status"], "staged")

    def test_apply_calls_the_database_function(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient()
            run_medicare_refresh(self._options(tmp, apply=True), client, fetch_json=FakeCms(make_rows()), log=quiet)
            self.assertEqual(client.rpcs, [("apply_medicare_refresh", {"p_run_id": "run-1"})])

    def test_same_content_gives_same_checksum(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = run_medicare_refresh(self._options(tmp), FakeClient(), fetch_json=FakeCms(make_rows()), log=quiet)
            b = run_medicare_refresh(self._options(tmp, page_size=5, batch_size=100), FakeClient(), fetch_json=FakeCms(make_rows()), log=quiet)
            self.assertEqual(a.content_checksum, b.content_checksum)

    def test_partial_release_is_refused_and_rolled_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient()
            with self.assertRaises(RuntimeError):
                run_medicare_refresh(self._options(tmp), client, fetch_json=FakeCms(make_rows(), reported=50), log=quiet)
            self.assertEqual(client.deletes, [("medicare_refresh_staging", {"refresh_run_id": "eq.run-1"})])
            self.assertEqual(client.updates[-1][1]["status"], "failed")

    def test_dry_run_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run_medicare_refresh(self._options(tmp, dry_run=True), None, fetch_json=FakeCms(make_rows()), log=quiet)
            self.assertIsNone(result.refresh_run_id)
            self.assertEqual(result.staged_rows, 0)
            self.assertEqual(json.loads(result.manifest_path.read_text())["status"], "dry-run")

    def test_pinned_or_fallback_dataset(self):
        with tempfile.TemporaryDirectory() as tmp:
            cms = FakeCms(make_rows())
            pinned = run_medicare_refresh(self._options(tmp, dataset_id=OLD_ID, dry_run=True), None, fetch_json=cms, log=quiet)
            self.assertEqual(pinned.dataset_id, OLD_ID)
            self.assertNotIn(CATALOG_URL, cms.urls)
            fallback = run_medicare_refresh(self._options(tmp, dry_run=True), None, fetch_json=FakeCms(make_rows(), catalog_fails=True), log=quiet)
            self.assertEqual(fallback.dataset_id, DEFAULT_DATASET_ID)

    def test_apply_with_dry_run_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                run_medicare_refresh(self._options(tmp, apply=True, dry_run=True), None, fetch_json=FakeCms(make_rows()), log=quiet)


if __name__ == "__main__":
    unittest.main()
