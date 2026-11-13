#!/usr/bin/env python3
"""Send today's new jobs from the job collector to nm7.si, and close the jobs whose link died.

Copy this file to the root of Solofounder0214/job-collector. Python 3.10+, standard library only.

  python post_to_nm7.py post  [--queue data/post_queue.json] [--details PATH] [--batch 25] [--dry-run]
  python post_to_nm7.py close [--link-check output/link_check/latest.json]

The key comes from the environment variable NM7_INGEST_KEY (the GitHub secret of the same name). Without it the
script prints one line and exits 0, so the morning run still succeeds. The key is never printed.

page_text: the plain text of each official job page, from fetch_details.py. nm7.si uses it once, to write its own
short summary, and never stores it. Where fetch_details keeps it is read from --details (or a page_text / text /
description field on the queue entry itself); see load_details() for the shapes understood.

Writes a summary to output/<date>/nm7_post.md (sent / created / updated / waiting for review / rejected by reason).
"""

import argparse
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
    queue = json.loads(pathlib.Path(args.queue).read_text(encoding="utf-8"))
    jobs = queue.get("jobs", queue) if isinstance(queue, dict) else queue
    details = load_details(args.details)
    rows = [to_nm7(j, details) for j in jobs if isinstance(j, dict)]
    totals = {k: 0 for k in ("created", "updated", "skipped", "review", "closed", "rejected")}
    rejected: dict[str, int] = {}
    review: dict[str, int] = {}
    for i in range(0, len(rows), args.batch):
        out = call("/api/jobs/collector", {"jobs": rows[i:i + args.batch], "dryRun": args.dry_run}, key)
        for k in totals:
            totals[k] += int(out.get(k, 0))
        for k, n in (out.get("rejectedBy") or {}).items():
            rejected[k] = rejected.get(k, 0) + n
        for r in out.get("results") or []:
            for why in r.get("reasons") or []:
                review[why] = review.get(why, 0) + 1
        print(f"nm7: batch {i // args.batch + 1}: " + ", ".join(f"{k} {out.get(k, 0)}" for k in totals))
        time.sleep(1)
    with_text = sum(1 for r in rows if len(r["page_text"]) >= 300)
    lines = [f"# nm7.si posting, {today()}{' (dry run: nothing saved)' if args.dry_run else ''}", "",
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
    p.add_argument("--queue", default="data/post_queue.json")
    p.add_argument("--details", default=os.environ.get("NM7_DETAILS", "data/details.json"))
    p.add_argument("--batch", type=int, default=25)
    p.add_argument("--dry-run", action="store_true")
    c = sub.add_parser("close")
    c.add_argument("--link-check", default="output/link_check/latest.json")
    args = ap.parse_args()
    (post if args.cmd == "post" else close)(args)


if __name__ == "__main__":
    main()
