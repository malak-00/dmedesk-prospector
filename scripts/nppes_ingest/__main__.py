"""Entry point so the package can be run as `python -m nppes_ingest`."""

from __future__ import annotations

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
