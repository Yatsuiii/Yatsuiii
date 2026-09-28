"""Read pages from a public Confluence space through its REST API."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterator, List, Tuple

Fetch = Callable[[str], bytes]


@dataclass(frozen=True)
class Page:
    id: str
    space: str
    title: str
    ancestors: Tuple[str, ...]
    last_modified: str
    url: str
    body: str = ""


def http_get(url: str, retries: int = 3, timeout: float = 60.0) -> bytes:
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


def page_from_json(item: dict, space: str, base_url: str) -> Page:
    version = item.get("version") or {}
    ancestors = tuple(a.get("title", "") for a in item.get("ancestors") or [])
    body = ((item.get("body") or {}).get("storage") or {}).get("value", "")
    webui = (item.get("_links") or {}).get("webui", "")
    return Page(
        id=str(item["id"]),
        space=space,
        title=item.get("title", ""),
        ancestors=ancestors,
        last_modified=version.get("when", ""),
        url=base_url.rstrip("/") + webui if webui else "",
        body=body,
    )


def iter_space_pages(
    base_url: str, space: str, fetch: Fetch = http_get, with_body: bool = True,
    limit: int = 50, pause: float = 0.25,
) -> Iterator[Page]:
    """Every current page in ``space``, following pagination.

    ``with_body=False`` fetches metadata only (titles, ancestors, edit dates),
    which is all the preregistered space-selection rule is allowed to see.
    """
    expand = "version,ancestors" + (",body.storage" if with_body else "")
    start = 0
    while True:
        params = urllib.parse.urlencode({
            "spaceKey": space, "type": "page", "status": "current",
            "limit": limit, "start": start, "expand": expand,
        })
        data = json.loads(fetch(f"{base_url.rstrip('/')}/rest/api/content?{params}"))
        results = data.get("results", [])
        for item in results:
            yield page_from_json(item, space, base_url)
        if not results or not (data.get("_links") or {}).get("next"):
            return
        start += len(results)
        time.sleep(pause)


def load_or_fetch(cache: Path, base_url: str, space: str, fetch: Fetch = http_get,
                  with_body: bool = True) -> List[Page]:
    """Pages from a JSONL cache, fetching and writing it on first use."""
    if cache.exists():
        pages = []
        for line in cache.read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            record["ancestors"] = tuple(record["ancestors"])
            pages.append(Page(**record))
        return pages
    pages = list(iter_space_pages(base_url, space, fetch, with_body=with_body))
    cache.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache.with_name(cache.name + ".part")
    tmp.write_text("\n".join(json.dumps(asdict(p)) for p in pages) + "\n", encoding="utf-8")
    tmp.replace(cache)
    return pages
