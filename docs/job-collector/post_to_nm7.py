#!/usr/bin/env python3
"""Send the job collector's India jobs to nm7.si (every experience level), and close the jobs whose link died.

Copy this file to the root of Solofounder0214/job-collector. Python 3.10+, standard library only.

  python post_to_nm7.py post  [--source PATH] [--seen data/nm7_seen.txt] [--details PATH] [--batch 25] [--dry-run]
  python post_to_nm7.py close [--link-check output/link_check/latest.json]

Round J2: nm7.si takes ALL India jobs, freshers to 15+ years. --source is the list of every India job in the
collector's window (CSV or JSON), not only the "not senior" new_jobs list. Default: the first that exists of
output/<date>/all_india_jobs_in_window.csv, data/all_india_jobs_in_window.csv, data/all_india_jobs_in_window.json,
data/post_queue.json (or the environment variable NM7_SOURCE). Jobs already sent are skipped: their links are kept in
--seen (one line per link, committed with the rest); --resend sends them again.

The key comes from the environment variable NM7_INGEST_KEY (the GitHub secret of the same name). Without it the
script prints one line and exits 0, so the morning run still succeeds. The key is never printed.

page_text: the plain text of each official job page, from fetch_details.py. nm7.si uses it once, to write its own
short summary, and never stores it. Where fetch_details keeps it is read from --details (or a page_text / text /
description field on the queue entry itself); see load_details() for the shapes understood.

Writes a summary to output/<date>/nm7_post.md (sent / created / updated / waiting for review / rejected by reason).
"""

import argparse
import csv
import datetime as dt
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("NM7_API", "https://nm7-api.onrender.com").rstrip("/")
UA = "Nm7JobCollector/1.0 (+https://nm7.si/contact)"
RETRY_STATUS = {502, 503, 504}
WAITS = [15, 30, 45, 60, 90]  # Render can take about a minute to wake up


def today() -> str:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).strftime("%Y-%m-%d")


def key_or_skip() -> str | None:
    k = os.environ.get("NM7_INGEST_KEY", "").strip()
    if not k:
        print("nm7: NM7_INGEST_KEY is not set (GitHub → Settings → Secrets and variables → Actions); not posting to nm7.si.")
        return None
    return k


def sent_back(key: str) -> set[str]:
    """Round M: the links Admin sent back from nm7.si (Admin → Jobs → Collector review). They are sent again even if
    they were sent before. A failure here never stops the run: the list is then just empty."""
    req = urllib.request.Request(f"{API}/api/jobs/collector/resend", method="GET",
                                 headers={"Authorization": f"Bearer {key}", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return {link_key(u) for u in json.loads(r.read() or b"{}").get("urls") or []}
    except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as e:
        print(f"nm7: couldn't read the sent-back list ({type(e).__name__}); carrying on without it")
        return set()


def call(path: str, body: dict, key: str) -> dict:
    """POST JSON with retries: 502/503/504 and timeouts wait and retry (Render waking up); 429 waits; 401 stops."""
    data = json.dumps(body).encode()
    last = ""
    for attempt, wait in enumerate([0, *WAITS]):
        if wait:
            print(f"nm7: retrying in {wait}s ({last})")
            time.sleep(wait)
        req = urllib.request.Request(f"{API}{path}", data=data, method="POST", headers={
            "Content-Type": "application/json", "Authorization": f"Bearer {key}", "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")[:300]
            if e.code in RETRY_STATUS:
                last = f"HTTP {e.code}"
                continue
            if e.code == 429:
                last = "HTTP 429 (too many requests)"
                time.sleep(int(e.headers.get("Retry-After") or 60))
                continue
            if e.code == 401:
                sys.exit("nm7: the key was refused (401). Check NM7_INGEST_KEY matches JOB_INGEST_KEY on Render.")
            if e.code == 503 and "ingest_off" in text:
                sys.exit("nm7: JOB_INGEST_KEY isn't set on Render yet (503 ingest_off).")
            raise SystemExit(f"nm7: HTTP {e.code}: {text}")
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = type(e).__name__
            continue
    raise SystemExit(f"nm7: gave up after {len(WAITS) + 1} tries ({last})")


def load_details(path: str | None) -> dict[str, str]:
    """url → page text. Understands: {"<url>": "<text>"}, [{"url": …, "page_text"|"text"|"description": …}],
    or a JSON-lines file of such objects. Missing file: no page text (those jobs wait for review on nm7.si)."""
    if not path or not pathlib.Path(path).exists():
        return {}
    raw = pathlib.Path(path).read_text(encoding="utf-8")
    try:
        data = json.loads(raw)
    except ValueError:
        data = [json.loads(line) for line in raw.splitlines() if line.strip()]
    if isinstance(data, dict) and not any(k in data for k in ("jobs", "items")):
        return {k: str(v or "") for k, v in data.items() if isinstance(v, str)}
    rows = data.get("jobs") or data.get("items") if isinstance(data, dict) else data
    out = {}
    for r in rows or []:
        if isinstance(r, dict) and r.get("url"):
            out[r["url"]] = str(r.get("page_text") or r.get("text") or r.get("description") or "")
    return out


SOURCES = ("output/{date}/all_india_jobs_in_window.csv", "data/all_india_jobs_in_window.csv",
           "data/all_india_jobs_in_window.json", "data/post_queue.json")


def find_source(given: str | None) -> pathlib.Path | None:
    for p in [given] if given else [x.format(date=today()) for x in SOURCES]:
        if p and pathlib.Path(p).exists():
            return pathlib.Path(p)
    return None


def _years(v):
    try:
        return int(float(v)) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def load_jobs(path: pathlib.Path) -> list[dict]:
    """The jobs in a CSV (header row: company, title, url or apply_url, location, posted, exp_min, exp_max, exp_text,
    system) or a JSON list / {"jobs": [...]}."""
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() == ".csv":
        rows = [{(k or "").strip().lower(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(text.splitlines())]
    else:
        data = json.loads(text)
        rows = data.get("jobs", []) if isinstance(data, dict) else data
    out = []
    for r in rows:
        if isinstance(r, dict):
            out.append({**r, "exp_min": _years(r.get("exp_min")), "exp_max": _years(r.get("exp_max"))})
    return out


def link_key(url: str) -> str:
    """The same normalised link nm7.si uses: no scheme, www, query, fragment or trailing slash, lower case."""
    u = (url or "").strip().lower().split("://", 1)[-1].removeprefix("www.")
    return u.split("?", 1)[0].split("#", 1)[0].rstrip("/")


def load_seen(path: str) -> set[str]:
    p = pathlib.Path(path)
    return set(p.read_text(encoding="utf-8").split()) if p.exists() else set()


def save_seen(path: str, seen: set[str]) -> None:
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(sorted(seen)) + "\n", encoding="utf-8")


def to_nm7(job: dict, details: dict[str, str]) -> dict:
    url = job.get("url") or job.get("apply_url") or ""
    return {
        "company": job.get("company", ""), "title": job.get("title", ""), "apply_url": url,
        "location": job.get("location") or "", "posted": str(job.get("posted") or ""),
        "exp_min": job.get("exp_min"), "exp_max": job.get("exp_max"), "exp_text": job.get("exp_text") or "",
        "system": job.get("system") or "",
        "page_text": (details.get(url) or job.get("page_text") or job.get("text") or "")[:60000],
    }


def post(args) -> None:
    key = key_or_skip()
    if not key:
        return
    src = find_source(args.source)
    if not src:
        print("nm7: no job list found (all_india_jobs_in_window.csv / post_queue.json); nothing sent")
        return
    details = load_details(args.details)
    seen = set() if args.resend else load_seen(args.seen)
    back = sent_back(key)
    seen -= back
    found = [to_nm7(j, details) for j in load_jobs(src)]
    rows = [r for r in found if r["apply_url"] and link_key(r["apply_url"]) not in seen]
    in_list = {link_key(r["apply_url"]) for r in found} & back
    print(f"nm7: {src}: {len(found)} jobs, {len(found) - len(rows)} already sent, sending {len(rows)}"
          f" ({len(in_list)} of {len(back)} sent back from nm7.si are in today's list)")
    totals = {k: 0 for k in ("created", "updated", "skipped", "review", "closed", "rejected")}
    rejected: dict[str, int] = {}
    review: dict[str, int] = {}
    for i in range(0, len(rows), args.batch):
        out = call("/api/jobs/collector", {"jobs": rows[i:i + args.batch], "dryRun": args.dry_run}, key)
        for k in totals:
            totals[k] += int(out.get(k, 0))
        for k, n in (out.get("rejectedBy") or {}).items():
            rejected[k] = rejected.get(k, 0) + n
        for job, r in zip(rows[i:i + args.batch], out.get("results") or []):
            for why in r.get("reasons") or []:
                review[why] = review.get(why, 0) + 1
            # worth sending again (round M: no page text too: a later run may fetch it)
            retry = {"invalid", "no_page_text", "ai_daily_limit", "summary_failed", "summary_unavailable"}
            if r.get("reason") not in retry and not retry & set(r.get("reasons") or []):
                seen.add(link_key(job["apply_url"]))  # answered for good (saved or refused): not sent again
        print(f"nm7: batch {i // args.batch + 1}: " + ", ".join(f"{k} {out.get(k, 0)}" for k in totals))
        time.sleep(1)
    if not args.dry_run:
        save_seen(args.seen, seen)
    with_text = sum(1 for r in rows if len(r["page_text"]) >= 300)
    lines = [f"# nm7.si posting, {today()}{' (dry run: nothing saved)' if args.dry_run else ''}", "",
             f"- From: {src} ({len(found)} India jobs in the window, {len(found) - len(rows)} sent before)",
             f"- Sent back from nm7.si: {len(back)} ({len(in_list)} in today's list, sent again)",
             f"- Sent: {len(rows)} (with page text: {with_text})",
             *(f"- {k.capitalize()}: {v}" for k, v in totals.items()), "",
             "## Rejected by reason", *([f"- {k}: {v}" for k, v in sorted(rejected.items())] or ["- none"]), "",
             "## Waiting for review: why", *([f"- {k}: {v}" for k, v in sorted(review.items())] or ["- none"])]
    write_report("\n".join(lines) + "\n")


def dead_links(path: str) -> list[str]:
    """Links the link check found dead. Understands [{"url", "ok"|"alive"|"status"|"dead"}], {"dead": [...]},
    {"broken": [...]}, or {"results": [...]} of the first shape. A 403 / 429 / timeout is NOT dead (no verdict)."""
    p = pathlib.Path(path)
    if not p.exists():
        return []
    data = json.loads(p.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        for k in ("dead", "broken", "closed"):
            if isinstance(data.get(k), list):
                return [x if isinstance(x, str) else x.get("url", "") for x in data[k]]
        data = data.get("results") or data.get("items") or []
    out = []
    for r in data:
        if not isinstance(r, dict) or not r.get("url"):
            continue
        status = r.get("status")
        if r.get("dead") is True or status in (404, 410):  # gone; a 403 / 429 / timeout gives no verdict
            out.append(r["url"])
    return out


def close(args) -> None:
    key = key_or_skip()
    if not key:
        return
    urls = [u for u in dead_links(args.link_check) if u]
    closed = 0
    for i in range(0, len(urls), 500):
        closed += int(call("/api/jobs/collector/close", {"urls": urls[i:i + 500]}, key).get("closed", 0))
    print(f"nm7: dead links sent {len(urls)}, jobs closed on nm7.si {closed}")
    write_report(f"\n## Link check ({today()})\n- Dead links sent: {len(urls)}\n- Closed on nm7.si: {closed}\n", append=True)


def write_report(text: str, append: bool = False) -> None:
    out = pathlib.Path("output") / today() / "nm7_post.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("a" if append else "w", encoding="utf-8") as f:
        f.write(text)
    print(f"nm7: summary written to {out}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("post")
    p.add_argument("--source", "--queue", dest="source", default=os.environ.get("NM7_SOURCE"))
    p.add_argument("--seen", default="data/nm7_seen.txt")
    p.add_argument("--resend", action="store_true")
    p.add_argument("--details", default=os.environ.get("NM7_DETAILS", "data/details.json"))
    p.add_argument("--batch", type=int, default=25)
    p.add_argument("--dry-run", action="store_true")
    c = sub.add_parser("close")
    c.add_argument("--link-check", default="output/link_check/latest.json")
    args = ap.parse_args()
    (post if args.cmd == "post" else close)(args)


if __name__ == "__main__":
    main()
