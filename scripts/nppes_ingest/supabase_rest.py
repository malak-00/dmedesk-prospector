"""Minimal PostgREST client over the standard library.

Deliberately no third-party dependency: this tool has to be runnable by
whoever is holding the monthly file, on a machine with nothing but Python
installed. `urllib` covers the four calls we actually make.

Uses the service-role key, so it bypasses RLS -- the same trust boundary
the Worker runs under. The key is only ever read from the environment and
is never logged.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Sequence

from .config import SupabaseConfig

DEFAULT_TIMEOUT_SECONDS = 60
MAX_ATTEMPTS = 4
RETRY_BASE_DELAY_SECONDS = 2.0


class SupabaseError(RuntimeError):
    """A PostgREST request failed."""


class SupabaseClient:
    def __init__(self, config: SupabaseConfig, *, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> None:
        self._config = config
        self._timeout = timeout

    # -- plumbing ---------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        body: Any = None,
        prefer: str | None = None,
    ) -> Any:
        url = f"{self._config.rest_url}/{path.lstrip('/')}"
        if params:
            url += "?" + urllib.parse.urlencode(params)

        payload = None if body is None else json.dumps(body).encode("utf-8")
        headers = {
            "apikey": self._config.service_role_key,
            "Authorization": f"Bearer {self._config.service_role_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer

        last_error: Exception | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            request = urllib.request.Request(url, data=payload, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=self._timeout) as response:
                    raw = response.read().decode("utf-8").strip()
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as err:
                detail = err.read().decode("utf-8", errors="replace").strip()
                # 4xx is our bug (bad payload, missing table, RLS) -- retrying
                # it just repeats the same mistake more slowly.
                if err.code < 500:
                    raise SupabaseError(f"{method} {path} failed with HTTP {err.code}: {detail}") from err
                last_error = SupabaseError(f"{method} {path} failed with HTTP {err.code}: {detail}")
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
                last_error = SupabaseError(f"{method} {path} failed: {err}")

            if attempt < MAX_ATTEMPTS:
                time.sleep(RETRY_BASE_DELAY_SECONDS * (2 ** (attempt - 1)))

        raise SupabaseError(str(last_error))

    # -- operations used by the ingest run --------------------------------

    def select(self, table: str, *, columns: str = "*", filters: dict[str, str] | None = None) -> list[dict[str, Any]]:
        params = {"select": columns}
        params.update(filters or {})
        result = self._request("GET", table, params=params)
        return result if isinstance(result, list) else []

    def insert(self, table: str, rows: Sequence[dict[str, Any]], *, returning: bool = False) -> list[dict[str, Any]]:
        if not rows:
            return []
        prefer = "return=representation" if returning else "return=minimal"
        result = self._request("POST", table, body=list(rows), prefer=prefer)
        return result if isinstance(result, list) else []

    def update(self, table: str, filters: dict[str, str], values: dict[str, Any]) -> None:
        self._request("PATCH", table, params=filters, body=values, prefer="return=minimal")

    def delete(self, table: str, filters: dict[str, str]) -> None:
        self._request("DELETE", table, params=filters, prefer="return=minimal")
