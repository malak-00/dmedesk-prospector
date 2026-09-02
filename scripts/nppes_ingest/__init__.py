"""Repository-owned NPPES ingestion CLI for DME Desk Prospector.

Loads an NPPES release (monthly full dissemination, weekly incremental, or
deactivation file) into the `nppes_refresh_staging` table under a single
`refresh_runs` row. It never writes to `npi_records` and never touches
`leads` -- applying staged data to the live provider record is a separate,
transactional SQL step (see documentation/plans/PROVIDER_CHANGE_TRACKING_PLAN.md).
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
