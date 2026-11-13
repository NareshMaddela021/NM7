"""Polite fetching for fetch_details.py (and anything else that opens company job pages).

Copy next to fetch_details.py and use `polite_get(url)` instead of requests.get / urlopen:
- obeys robots.txt (cached per site); a page robots.txt disallows is skipped
- at least DELAY seconds between two requests to the same host
- a clear User-Agent with a contact link
- a host that answers 403 or 429 is skipped for the rest of the run (no hard retries)
- never opens LinkedIn, Naukri, Indeed or other job boards
Standard library only.
"""

import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

UA = "Nm7JobCollector/1.0 (+https://nm7.si/contact)"
DELAY = 3.0  # seconds between requests to one host
NEVER = ("linkedin.", "naukri.", "indeed.", "glassdoor.", "monster.", "foundit.", "shine.com", "timesjobs.",
         "internshala.", "apna.co", "workindia.", "hirist.", "instahyre.", "cutshort.", "wellfound.", "iimjobs.")

_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
_last: dict[str, float] = {}
_blocked: set[str] = set()


def _host(url: str) -> str:
    return urllib.parse.urlsplit(url).netloc.lower()


def allowed(url: str) -> bool:
    host = _host(url)
    if host in _blocked or any(n in host for n in NEVER):
        return False
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(f"{urllib.parse.urlsplit(url).scheme}://{host}/robots.txt")
        try:
            req = urllib.request.Request(rp.url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=15) as r:
                rp.parse(r.read().decode("utf-8", "replace").splitlines())
        except urllib.error.HTTPError as e:
            rp = None if e.code in (401, 403) else rp  # robots.txt forbidden: treat the site as off limits
            if rp is not None:
                rp.parse([])  # no robots.txt (404): everything allowed
        except Exception:  # noqa: BLE001  (unreachable robots.txt: be careful, allow, the delay still applies)
            rp.parse([])
        _robots[host] = rp
    rp = _robots[host]
    return bool(rp) and rp.can_fetch(UA, url)


def polite_get(url: str, timeout: float = 30) -> str | None:
    """The page's HTML, or None when it must not or could not be fetched (never raises for a single page)."""
    if not allowed(url):
        return None
    host = _host(url)
    wait = DELAY - (time.monotonic() - _last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(3_000_000).decode(r.headers.get_content_charset() or "utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            _blocked.add(host)  # the site said no / slow down: leave it alone for today
        return None
    except Exception:  # noqa: BLE001
        return None
