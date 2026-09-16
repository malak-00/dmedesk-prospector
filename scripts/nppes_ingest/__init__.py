"""Repository-owned NPPES ingestion CLI for DME Desk Prospector.

Loads an NPPES release (monthly full dissemination, weekly incremental, or
deactivation file) into the `nppes_refresh_staging` table under a single
`refresh_runs` row, streaming it in batches. Applying a staged run to
`npi_records` is done by reviewed SQL (sql/007_nppes_refresh_lifecycle.sql),
driven in batches by `--apply` / `--apply-run`. It never touches `leads`.
"""

__all__ = ["__version__"]

__version__ = "0.2.0"
