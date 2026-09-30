"""Stream GH Archive hourly files in-process (urllib + gzip) and yield parsed events.

In-process fetching (no curl/zcat child processes) so a long background run is not killed
for rapid subprocess spawning. urllib honours the session's HTTPS_PROXY automatically.
"""
from __future__ import annotations

import gzip
import io
import os
import ssl
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Iterator

import orjson

BASE = "https://data.gharchive.org"
_CA = os.environ.get("REQUESTS_CA_BUNDLE") or "/root/.ccr/ca-bundle.crt"
_CTX = ssl.create_default_context(cafile=_CA if os.path.exists(_CA) else None)


def hour_urls(start: str, end: str) -> list:
    d0 = datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    d1 = datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    urls, d = [], d0
    while d <= d1:
        for h in range(24):
            urls.append(f"{BASE}/{d.strftime('%Y-%m-%d')}-{h}.json.gz")
        d += timedelta(days=1)
    return urls


def _fetch(url: str, retries: int = 4) -> bytes | None:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "stalefence-study"})
            with urllib.request.urlopen(req, timeout=120, context=_CTX) as r:
                if r.status != 200:
                    return None
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None  # missing hour
            if attempt == retries - 1:
                return None
        except Exception:
            if attempt == retries - 1:
                return None
        time.sleep(2 ** attempt)
    return None


def stream_hour(url: str) -> Iterator[dict]:
    """Yield raw event dicts for one hour. Empty on a missing/failed hour."""
    raw = _fetch(url)
    if not raw:
        return
    try:
        data = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
    except Exception:
        return
    for line in data.split(b"\n"):
        if not line:
            continue
        try:
            yield orjson.loads(line)
        except orjson.JSONDecodeError:
            continue
