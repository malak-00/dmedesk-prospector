"""Environment configuration.

Credentials come from the process environment, optionally seeded from a
dotenv-style file (`scripts/.env` by default, which is gitignored). Nothing
here reads a hardcoded personal path, and nothing is ever written back to
disk -- the previous generation of this tooling hardcoded one developer's
`C:\\Users\\...` paths, which is exactly what made it unrunnable by anyone
else.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or malformed."""


def load_env_file(path: Path) -> dict[str, str]:
    """Parse a minimal KEY=VALUE dotenv file.

    Blank lines and `#` comments are skipped. Values may be wrapped in
    single or double quotes. Existing environment variables always win, so
    an explicit `SUPABASE_URL=... python -m nppes_ingest` overrides the file.
    """
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key:
            values[key] = value
    return values


@dataclass(frozen=True)
class SupabaseConfig:
    """Connection settings for the DME Desk Supabase project."""

    url: str
    service_role_key: str

    @property
    def rest_url(self) -> str:
        return self.url.rstrip("/") + "/rest/v1"


def load_supabase_config(env_file: Path | None = None) -> SupabaseConfig:
    """Read Supabase credentials from the environment (and optional env file)."""
    file_values = load_env_file(env_file if env_file is not None else DEFAULT_ENV_FILE)

    def read(key: str) -> str:
        return (os.environ.get(key) or file_values.get(key) or "").strip()

    url = read("SUPABASE_URL")
    key = read("SUPABASE_SERVICE_ROLE_KEY")

    missing = [name for name, value in (("SUPABASE_URL", url), ("SUPABASE_SERVICE_ROLE_KEY", key)) if not value]
    if missing:
        raise ConfigError(
            "Missing required configuration: "
            + ", ".join(missing)
            + ". Set them in the environment or in scripts/.env (gitignored). "
            + "Use --dry-run to validate a file without any credentials."
        )
    if not url.startswith("https://"):
        raise ConfigError(f"SUPABASE_URL must be an https:// URL, got {url!r}")
    return SupabaseConfig(url=url, service_role_key=key)
