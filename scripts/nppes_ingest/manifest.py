"""Run manifest: what file was loaded, and what happened to every row.

The manifest is the durable record that makes a refresh auditable after the
fact -- source checksum, counts in and out, and why rows were dropped. It is
written locally (and echoed into `refresh_runs.metadata`) so a run can be
reconstructed even if the staging table has since been cleared.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CHECKSUM_CHUNK_BYTES = 1024 * 1024


def file_checksum(path: Path) -> str:
    """Streaming SHA-256 -- dissemination files are far too big to slurp."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHECKSUM_CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass
class RunManifest:
    """Everything known about one ingest run."""

    run_type: str
    source_file: str
    source_checksum: str
    source_bytes: int
    source_version: str | None = None
    release_date: str | None = None
    label: str | None = None
    refresh_run_id: str | None = None
    dry_run: bool = False
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    finished_at: str | None = None
    status: str = "running"
    source_rows: int = 0
    accepted_rows: int = 0
    rejected_rows: int = 0
    staged_rows: int = 0
    rejections_by_reason: dict[str, int] = field(default_factory=dict)
    filters: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    def finish(self, status: str, error: str | None = None) -> None:
        self.status = status
        self.error = error
        self.finished_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_run_metadata(self) -> dict[str, Any]:
        """The subset stored on `refresh_runs.metadata`."""
        data = self.to_dict()
        data.pop("refresh_run_id", None)
        return data

    def write(self, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return path
