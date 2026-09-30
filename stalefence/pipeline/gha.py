"""Stream GH Archive hourly files through curl|zcat and yield parsed events."""
from __future__ import annotations

import subprocess
from datetime import datetime, timedelta, timezone
from typing import Iterator

import orjson

BASE = "https://data.gharchive.org"


def hour_urls(start: str, end: str) -> list:
    """Inclusive list of hourly URLs from start to end (UTC, 'YYYY-MM-DD-H' granularity by day)."""
    d0 = datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    d1 = datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    urls = []
    d = d0
    while d <= d1:
        for h in range(24):
            urls.append(f"{BASE}/{d.strftime('%Y-%m-%d')}-{h}.json.gz")
        d += timedelta(days=1)
    return urls


def stream_hour(url: str, retries: int = 3) -> Iterator[dict]:
    """Yield raw event dicts for one hour. Empty on a missing/failed hour."""
    cmd = ["bash", "-c", f'curl -sS --fail --retry {retries} --max-time 300 "{url}" | zcat']
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=1 << 20)
    try:
        for line in p.stdout:
            if not line:
                continue
            try:
                yield orjson.loads(line)
            except orjson.JSONDecodeError:
                continue
    finally:
        p.stdout.close()
        p.wait()
