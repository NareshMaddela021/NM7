"""Auto Apply 2.0, phase A5 ("open forms"): simple application forms on a company's OWN website, filled and sent by
plain HTTP (httpx), politely, with proof kept for the candidate.

Which jobs (route): a job whose "Apply" link is on the company's own site. Never a job board (polite.JOB_BOARDS), never
a hosted hiring system or form builder (polite.HOSTED), never a site Nm7 remembers as one-tap only, blocked by
robots.txt or by its terms. While the Auto Apply 2.0 switch is OFF only the A2 pairing rule lets a form through
(access.pair_ok: a tester ↔ a company with a listed tester on its team); demo accounts never touch the network.

How (attempt, in the background pass inside heavy_or_skip, at most PER_PASS forms and one per site a pass):
  1. robots.txt (cached a day) must allow our user agent (or "*") for the page and the form's address;
  2. the page is read (polite: honest user agent, DELAY between requests to a site, daily caps, timeouts, redirects
     checked one by one: another site or a login page stops it);
  3. the site's terms page, when the page links one, is read once a month: a rule against bots, scraping, crawling or
     automated use stops it for good;
  4. the page must hold one plain HTML form that posts on the same site, with no CAPTCHA or any challenge, no
     password (login / account), no steps, no payment and nothing that needs JavaScript;
  5. the form is filled only from the candidate's resume (the tailored version), saved answers and Nm7 profile;
     anything required that Nm7 doesn't know goes to "Waiting for you" (answered once, saved, never asked again);
     a resume upload gets the tailored resume PDF;
  6. it is posted once. 403 / 429, a CAPTCHA, an error, a redirect to a login page or to another site → the site is
     remembered as one-tap only (Admin can reset it) and the job is "Ready" for the candidate's one tap.
Proof (form_proof, on the item and the application): the fields sent (hidden form tokens shown without their value;
Nm7 never handles passwords), the file name, the HTTP status, the final address, a text snapshot of the answer page
(SNAPSHOT_MAX characters) and the time. The candidate sees it in "What was sent".

Site memory (`auto_form_sites`, one per site): state new / allowed / one_tap / robots / terms / job_board, the reason,
when it was last tried, successes and failures, robots.txt and terms checks, today's request and submit counts.
"""

import logging
from datetime import timedelta
from typing import Any
from urllib.parse import urljoin

import httpx

from app.audit import audit
from app.autoapply import access
from app.autoapply.forms import page, polite
from app.core import reviewer
from app.core.db import AUTO_COPIES, AUTO_ITEMS, COMPANIES, FORM_SITES, JOBS, USERS
from app.core.time import now

log = logging.getLogger("nm7.autoapply.forms")

PER_PASS = 4  # forms a pass tries (each one is a few polite requests, DELAY apart)
LEASE = timedelta(minutes=15)
ROBOTS_TTL = timedelta(days=1)
TERMS_TTL = timedelta(days=30)
LATER = timedelta(hours=6)  # today's cap for a site is used: try again later
MAX_HOPS = 4
STOPPED = ("one_tap", "robots", "terms", "job_board")  # never automated again (until Admin resets the site)
STATE_TEXT = {
    "new": "Not tried yet",
    "allowed": "Allowed (simple form)",
    "one_tap": "One tap only",
    "robots": "Blocked by robots.txt",
    "terms": "Blocked by its terms",
    "job_board": "Job board (never used)",
}
# why a job is "Ready" for the candidate's one tap instead (candidate-facing; None = say nothing, as before A5)
REASONS = {
    "captcha": "The company’s form has a CAPTCHA. Nm7 never solves those, so it’s ready for you to apply.",
    "login": "The company’s site asks you to sign in or make an account. Nm7 never does that for you.",
    "login_redirect": "The company’s site sent Nm7 to a sign-in page. Nm7 never signs in for you.",
    "robots": "The company’s site asks bots not to use it (robots.txt), so Nm7 leaves it to you.",
    "robots_forbidden": "The company’s site asks bots not to use it (robots.txt), so Nm7 leaves it to you.",
    "terms": "The company’s website terms don’t allow automated use, so Nm7 leaves it to you.",
    "job_board": "This link goes to a job board. Nm7 never uses job boards.",
    "hosted": "The form is on a hiring system or a form builder, not the company’s own site.",
    "not_company_site": "The link isn’t on the company’s own website.",
    "needs_js": "The company’s form needs a full browser, so it’s ready for you to apply.",
    "multi_step": "The company’s form has several steps, so it’s ready for you to apply.",
    "payment": "The company’s form asks for a payment. Nm7 never pays for anything.",
    "not_post": "The company’s form isn’t a simple one, so it’s ready for you to apply.",
    "form_elsewhere": "The company’s form sends your details to another site, so it’s ready for you to apply.",
    "redirect": "The company’s site sent Nm7 somewhere unexpected, so it’s ready for you to apply.",
    "http_403": "The company’s site turned Nm7 away, so it’s ready for you to apply.",
    "http_429": "The company’s site asked Nm7 to slow down, so it’s ready for you to apply.",
    "server": "The company’s site had a problem, so it’s ready for you to apply.",
    "form_error": "The company’s form didn’t accept the application, so it’s ready for you to apply.",
    "no_answer": "The company’s site didn’t answer, so it’s ready for you to apply.",
    "private": "The link doesn’t lead to a public website.",
    "site_one_tap": "Nm7 leaves this company’s site to you: apply with one tap.",
    "no_form": "Nm7 couldn’t find a simple application form on the page.",
    "needs_file": "The form asks for a file other than your resume.",
    "page_gone": "The job page couldn’t be found.",
    "site_unreachable": "Nm7 couldn’t check the company’s robots.txt, so it’s ready for you to apply.",
    "error": "Something went wrong with the company’s form, so it’s ready for you to apply.",
}
QUIET = ("switch_off", "demo", "no_url")  # one tap as before A5, with nothing to explain


class Stop(Exception):
    """Stop this form: `reason` for the candidate; `remember` = the site state to keep (None = this job only)."""

    def __init__(self, reason: str, remember: str | None = None):
        super().__init__(reason)
        self.reason = reason
        self.remember = remember


def site_key(j: dict[str, Any]) -> str:
    return polite.site_of(polite.host_of(str((j.get("apply") or {}).get("url") or "")))


def _base(host: str) -> str:
    from app.autoapply.emailing import base_domain

    return base_domain(host)


async def _seen(db, key: str, **sets: Any) -> None:
    t = now()
    await db[FORM_SITES].update_one(
        {"_id": key},
        {
            "$setOnInsert": {"first_seen": t, "successes": 0, "failures": 0, **({} if "state" in sets else
                                                                                  {"state": "new"})},
            "$set": {"updated_at": t, **sets},
        },
        upsert=True,
    )  # fmt: skip


async def remember(db, key: str, state: str, reason: str) -> None:
    """The site is never automated again (one-tap only, robots, terms, job board) until Admin resets it."""
    t = now()
    await db[FORM_SITES].update_one(
        {"_id": key},
        {
            "$setOnInsert": {"first_seen": t, "successes": 0},
            "$set": {"state": state, "reason": reason, "stopped_at": t, "last_tried": t, "updated_at": t},
            "$inc": {"failures": 1},
        },
        upsert=True,
    )
    log.info("auto apply form: site %s → %s (%s)", key, state, reason)


async def route(db, u: dict[str, Any] | None, j: dict[str, Any], site: dict[str, Any]) -> str | None:
    """None when this job may go through the company-form channel, else why not (it stays one tap)."""
    if not u or u.get("demo") or j.get("demo") or reviewer.is_reviewer(u):
        return "demo"  # demo accounts (and the Chrome Web Store review account) never touch the network
    url = str((j.get("apply") or {}).get("url") or "").strip()
    host = polite.host_of(url)
    if not host or not url.lower().startswith(("http://", "https://")):
        return "no_url"
    key = polite.site_of(host)
    if polite.is_job_board(url):
        await _seen(db, key, state="job_board", reason="job_board")
        return "job_board"
    if polite.is_hosted(url):
        await _seen(db, key, last_route="hosted")
        return "hosted"
    web = polite.host_of("https://" + str((j.get("company") or {}).get("website") or "").split("://")[-1])
    if web and _base(polite.site_of(web)) != _base(key):
        return "not_company_site"
    v2 = site["auto_apply_v2"]
    cid = j.get("company_id")
    c = await db[COMPANIES].find_one({"_id": cid}, {"members": 1, "demo": 1}) if cid else None
    if not (v2.get("public") and not (c or {}).get("demo")) and not access.pair_ok(u, c, v2):
        return "switch_off"  # while OFF: never a real company's form for a real candidate
    mem = await db[FORM_SITES].find_one({"_id": key}, {"state": 1})
    if mem and mem.get("state") in STOPPED:
        return "job_board" if mem["state"] == "job_board" else "site_one_tap"
    await _seen(db, key)
    return None


async def enqueue(db, it: dict[str, Any], j: dict[str, Any], u: dict[str, Any], site: dict[str, Any]) -> dict:
    """From v2engine.send (via engine.deliver): queue this application for the background form pass."""
    why = await route(db, u, j, site)
    if why:
        return {"state": "ready", "reason": why, "channel_v2": "one_tap", "ready_day": _today()}
    return {"state": "form_queued", "form_next_at": now(), "form_site": site_key(j), "channel_v2": "form"}


def _today() -> str:
    from app.autoapply.engine import today

    return today()


async def _to_one_tap(db, it: dict[str, Any], reason: str, proof: dict | None = None) -> str:
    sets: dict[str, Any] = {"state": "ready", "reason": reason, "channel_v2": "one_tap", "ready_day": _today(),
                            "updated_at": now()}  # fmt: skip
    if proof:
        sets["form_proof"] = proof
    await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": sets, "$unset": {"counted_day": ""}})
    return "one_tap"


# ---------- the facts a form may be filled with ----------


async def facts(db, u: dict[str, Any], j: dict[str, Any], copy: dict[str, Any]) -> page.Facts:
    from app.autoapply import instant, pdf
    from app.autoapply.emailing import profile_link

    data = copy.get("data") or {}
    p = data.get("personal") or {}
    name = (p.get("name") or u.get("name") or "").split()
    links = {k: str(v) for k, v in (data.get("links") or {}).items() if v}
    for k in ("linkedin", "github", "portfolio", "website"):
        if p.get(k) and k not in links:
            links[k] = str(p[k])
    links = {k: (v if v.startswith("http") else "https://" + v) for k, v in links.items()}
    cur = next((e for e in data.get("exp") or [] if e.get("current")), None) or {}
    edu = (data.get("edu") or [{}])[0] or {}
    f = await instant.facts(db, u)
    lines = [str(x) for x in copy.get("cover_note") or []]
    prof = await profile_link(db, u["_id"])
    cover = "\n".join([*lines, "", *([f"Nm7 profile: {prof}"] if prof else []),
                       "Sent by Nm7 Auto Apply on the candidate’s behalf."]).strip()  # fmt: skip
    return page.Facts(
        first=name[0] if name else "",
        last=" ".join(name[1:]),
        email=u.get("email") or p.get("email") or "",
        phone=str(p.get("phone") or "")[:40],
        city=str(p.get("location") or "").split(",")[0].strip(),
        links=links,
        current_company=str(cur.get("company") or ""),
        current_title=str(cur.get("role") or ""),
        degree=" ".join(x for x in (str(edu.get("degree") or ""), str(edu.get("field") or "")) if x),
        college=str(edu.get("institution") or ""),
        grad_year=str(edu.get("to") or "")[:4],
        notice=f.get("notice") or "",
        salary=f.get("salary") or "",
        cover=cover,
        job_title=j.get("title") or "",
        profile=prof,
        saved=(u.get("auto_apply") or {}).get("answers") or {},
        resume_name=pdf.file_name(data),
    )


# ---------- one form ----------


async def _robots(db, http, key: str, url: str) -> str:
    mem = await db[FORM_SITES].find_one({"_id": key}, {"robots": 1}) or {}
    rb = mem.get("robots") or {}
    if rb.get("at") and rb["at"] > now() - ROBOTS_TTL and rb.get("kind") == "ok":
        return rb.get("txt") or ""
    kind, txt = await polite.fetch_robots(db, http, url)
    await db[FORM_SITES].update_one({"_id": key}, {"$set": {"robots": {"kind": kind, "txt": txt or "", "at": now()}}})
    if kind == "forbidden":
        raise Stop("robots_forbidden", "robots")
    if kind == "unreachable":
        raise Stop("site_unreachable")
    return txt or ""


def _check_hop(key: str, url: str, robots: str) -> None:
    if polite.is_job_board(url):
        raise Stop("job_board", "one_tap")
    if page.login_url(url):
        raise Stop("login_redirect", "one_tap")
    if _base(polite.site_of(polite.host_of(url))) != _base(key):
        raise Stop("redirect", "one_tap")
    if not polite.robots_allow(robots, url):
        raise Stop("robots", "robots")


async def _go(db, http, method: str, url: str, key: str, robots: str, **kw) -> polite.Answer:
    """A request and its redirects, each hop checked (same site, no login page, robots.txt)."""
    r = await polite.request(db, http, method, url, submit=method == "POST", **kw)
    for _ in range(MAX_HOPS):
        if not (300 <= r.status < 400 and r.location):
            return r
        if r.status in (307, 308) and method == "POST":
            raise Stop("redirect", "one_tap")  # it would post the application again somewhere else
        nxt = urljoin(r.url, r.location)
        _check_hop(key, nxt, robots)
        r = await polite.request(db, http, "GET", nxt)
    raise Stop("redirect", "one_tap")


def _status_stop(status: int) -> None:
    if status == 403 or status == 401:
        raise Stop("http_403", "one_tap")
    if status == 429:
        raise Stop("http_429", "one_tap")
    if status >= 500:
        raise Stop("server", "one_tap")
    if status in (404, 410):
        raise Stop("page_gone")
    if status >= 400:
        raise Stop("error", "one_tap")


async def _terms(db, http, key: str, url: str, pg: page.Page, robots: str) -> None:
    mem = await db[FORM_SITES].find_one({"_id": key}, {"terms": 1}) or {}
    tm = mem.get("terms") or {}
    if tm.get("at") and tm["at"] > now() - TERMS_TTL:
        if tm.get("forbidden"):
            raise Stop("terms", "terms")
        return
    found: dict[str, Any] = {"url": "", "forbidden": False, "phrase": "", "at": now()}
    for href in page.terms_links(pg):
        turl = urljoin(url, href)
        if _base(polite.site_of(polite.host_of(turl))) != _base(key) or not polite.robots_allow(robots, turl):
            continue
        try:
            r = await _go(db, http, "GET", turl, key, robots)
        except Stop:
            continue
        if r.status >= 400:
            continue
        found["url"] = turl
        phrase = page.terms_forbid(page.parse(r.text).text if "<" in r.text else r.text)
        if phrase:
            found |= {"forbidden": True, "phrase": phrase}
        break
    await db[FORM_SITES].update_one({"_id": key}, {"$set": {"terms": found}})
    if found["forbidden"]:
        raise Stop("terms", "terms")


def _proof(url: str, action: str, filled: page.Filled, r: polite.Answer | None, ok: bool, test: bool) -> dict:
    file = next(({"name": p["value"], "size": p.get("size")} for p in filled.proof if p["kind"] == "file"), None)
    return {
        "page": url,
        "action": action,
        "method": "POST",
        "fields": [
            {"label": p["label"], "value": "" if p["kind"] == "hidden" else p["value"], "kind": p["kind"]}
            for p in filled.proof
            if p["kind"] != "file"
        ],
        "file": file,
        "status": r.status if r else None,
        "final_url": r.url if r else "",
        "snapshot": page.snapshot(r.text) if r else "",
        "confirmed": bool(r and page.success(page.snapshot(r.text, 20000))),
        "ok": ok,
        "test": test,
        "at": now(),
    }


async def attempt(db, it: dict[str, Any], site: dict[str, Any], http: httpx.AsyncClient) -> str:
    """Try one queued form. → applied / needs_answer / one_tap / later / expired."""
    from app.autoapply import engine, pdf

    u = await db[USERS].find_one({"_id": it["user_id"]}, {**access.PROJECTION, "name": 1, "auto_apply": 1})
    j = await db[JOBS].find_one({"_id": it["job_id"]})
    if not j or j.get("status") != "active":
        await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"state": "expired", "updated_at": now()}})
        return "expired"
    if why := await route(db, u, j, site):
        return await _to_one_tap(db, it, why)
    copy = await db[AUTO_COPIES].find_one({"_id": it.get("copy_id")}) if it.get("copy_id") else None
    if not copy:
        return await _to_one_tap(db, it, "error")
    url = j["apply"]["url"]
    key = site_key(j)
    if not await polite.submits_left(db, key):
        await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"form_next_at": now() + LATER}})
        return "later"
    await db[FORM_SITES].update_one({"_id": key}, {"$set": {"last_tried": now()}})
    test = not site["auto_apply_v2"].get("public")
    filled: page.Filled | None = None
    action = ""
    r = None
    try:
        robots = await _robots(db, http, key, url)
        if not polite.robots_allow(robots, url):
            raise Stop("robots", "robots")
        got = await _go(db, http, "GET", url, key, robots)
        _status_stop(got.status)
        if page.captcha(got.text):
            raise Stop("captcha", "one_tap")
        if page.login_url(got.url):
            raise Stop("login_redirect", "one_tap")
        pg = page.parse(got.text)
        await _terms(db, http, key, got.url, pg, robots)
        fm = page.application_form(pg)
        if why := page.blocker(pg, fm):
            raise Stop(why, "one_tap")
        if fm is None:
            raise Stop("no_form")
        action = urljoin(got.url, fm.action or got.url)
        if polite.is_job_board(action) or _base(polite.site_of(polite.host_of(action))) != _base(key):
            raise Stop("form_elsewhere", "one_tap")
        if not polite.robots_allow(robots, action):
            raise Stop("robots", "robots")
        f = await facts(db, u, j, copy)
        has_file = any(x.type == "file" for x in fm.fields)
        filled = page.fill(fm, f, pdf.render(copy.get("data") or {}) if has_file else b"")
        if filled.needs_file:
            raise Stop("needs_file")
        if filled.missing:
            await db[AUTO_ITEMS].update_one(
                {"_id": it["_id"]},
                {
                    "$set": {"state": "needs_answer", "kind": "form", "form_missing": filled.missing[:10],
                             "missing": [q["id"] for q in filled.missing[:10]], "updated_at": now()},
                    "$unset": {"counted_day": ""},
                },
            )  # fmt: skip
            return "needs_answer"
        if fm.enctype.startswith("multipart") or filled.files:
            kw: dict[str, Any] = {"data": dict(_multi(filled.data)), "files": filled.files or None}
        else:
            kw = {"data": filled.data}
        r = await _go(db, http, "POST", action, key, robots, headers={"Referer": got.url}, **kw)
        _status_stop(r.status)
        if page.captcha(r.text):
            raise Stop("captcha", "one_tap")
        if page.login_url(r.url):
            raise Stop("login_redirect", "one_tap")
        again = page.application_form(page.parse(r.text))
        if again is not None and page.failed(page.snapshot(r.text, 20000)):
            raise Stop("form_error", "one_tap")
    except Stop as e:
        if e.remember:
            await remember(db, key, e.remember, e.reason)
        proof = _proof(url, action, filled, r, False, test) if (filled and r) else None
        return await _to_one_tap(db, it, e.reason, proof)
    except polite.Refused as e:
        if e.kind == "daily_cap":
            await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"form_next_at": now() + LATER}})
            return "later"
        if e.kind == "job_board":
            await remember(db, key, "job_board", "job_board")
        return await _to_one_tap(db, it, e.kind if e.kind in REASONS else "error")
    except httpx.HTTPError:
        await remember(db, key, "one_tap", "no_answer")
        proof = _proof(url, action, filled, None, False, test) if filled else None
        return await _to_one_tap(db, it, "no_answer", proof)
    proof = _proof(url, action, filled, r, True, test)
    t = now()
    extra = {"v2": True, "channel_v2": "form", "cover_note": copy.get("cover_note") or [], "form_proof": proof}
    app = await engine.apply_nm7(db, it, j, u, copy, {}, channel="form", extra=extra)
    await db[AUTO_ITEMS].update_one(
        {"_id": it["_id"]},
        {"$set": {"state": "applied", "applied_at": t, "channel_v2": "form", "form_proof": proof,
                  "counted_day": it.get("counted_day") or _today(), "updated_at": t},
         "$unset": {"form_missing": ""}},
    )  # fmt: skip
    await db[FORM_SITES].update_one({"_id": key, "state": "new"}, {"$set": {"state": "allowed", "reason": ""}})
    await db[FORM_SITES].update_one({"_id": key}, {"$inc": {"successes": 1}, "$set": {"last_ok": t}})
    if not app:
        log.info("auto apply form: %s already had an application record", it["_id"])
    return "applied"


def _multi(pairs: list[tuple[str, str]]) -> dict[str, Any]:
    """httpx multipart data: repeated names become lists."""
    out: dict[str, Any] = {}
    for k, v in pairs:
        if k in out:
            out[k] = (out[k] if isinstance(out[k], list) else [out[k]]) + [v]
        else:
            out[k] = v
    return out


# ---------- the background pass ----------


async def run(db, limit: int = PER_PASS) -> dict[str, Any]:
    from app.core.heavy import heavy_or_skip
    from app.site import get_site

    site = await get_site(db)
    if not site["auto_apply"]["on"]:
        return {"off": True}
    counts: dict[str, Any] = {}
    async with heavy_or_skip(db) as ok:
        if not ok:
            return {"waiting_heavy": True}
        t = now()
        sites: set[str] = set()
        done = 0
        async with polite.client() as http:
            q = {"state": "form_queued", "form_next_at": {"$lte": t}}
            cursor = db[AUTO_ITEMS].find(q, {"_id": 1, "form_site": 1}).sort("form_next_at", 1).limit(limit * 5)
            async for row in cursor.batch_size(50):
                if done >= limit:
                    break
                if row.get("form_site") in sites:
                    continue  # one form per site a pass
                it = await db[AUTO_ITEMS].find_one_and_update(
                    {"_id": row["_id"], **q}, {"$set": {"form_next_at": t + LEASE}}
                )
                if not it:
                    continue
                sites.add(row.get("form_site"))
                done += 1
                try:
                    state = await attempt(db, it, site, http)
                except Exception:  # noqa: BLE001 — one bad page never stops the pass
                    log.exception("auto apply form: attempt failed")
                    state = await _to_one_tap(db, it, "error")
                counts[state] = counts.get(state, 0) + 1
    return counts


async def kick(db) -> None:
    """A background task after an approval or an answer: try the form now instead of at the next pass."""
    try:
        await run(db, limit=2)
    except Exception:  # noqa: BLE001
        log.exception("auto apply form: kick failed")


# ---------- the candidate's answers (Waiting for you) ----------


def open_questions(it: dict[str, Any], u: dict[str, Any]) -> list[dict[str, Any]]:
    from app.autoapply.engine import norm

    saved = (u.get("auto_apply") or {}).get("answers") or {}
    return [q for q in it.get("form_missing") or [] if norm(q["text"]) not in saved]


def clean_answers(qs: list[dict[str, Any]], given: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """The candidate's answers to form questions: yes / no, a whole number, one of the options, or short text."""
    from app.companies import questions as qmod

    fixed = [q for q in qs if q["kind"] in ("yesno", "number", "choice")]
    out, problems = qmod.answers_for(fixed, given)
    for q in qs:
        if q["kind"] != "text":
            continue
        v = " ".join(str((given or {}).get(q["id"]) or "").split())
        if not v or len(v) > 500:
            problems.append(f"Answer: {q['text']}")
            continue
        out[q["id"]] = v
    return out, problems


async def answered(db, u: dict[str, Any], it: dict[str, Any], site: dict[str, Any], day_left: int) -> str:
    """All questions answered: back in the queue (counted in today's limit), or "queued" for tomorrow."""
    from app.autoapply.engine import today

    if day_left <= 0:
        await db[AUTO_ITEMS].update_one(
            {"_id": it["_id"]}, {"$set": {"state": "queued", "approved": True, "updated_at": now()}}
        )
        return "queued"
    await db[AUTO_ITEMS].update_one(
        {"_id": it["_id"]},
        {"$set": {"state": "form_queued", "form_next_at": now(), "counted_day": today(), "approved": True,
                  "updated_at": now()}},
    )  # fmt: skip
    return "form_queued"


# ---------- Admin: the site list ----------


async def sites(db, limit: int = 500) -> list[dict[str, Any]]:
    from app.me.service import ms

    rows = await db[FORM_SITES].find({}, {"robots.txt": 0}).sort("last_tried", -1).limit(limit).to_list(limit)
    rows.sort(key=lambda r: r.get("last_tried") or r.get("first_seen") or now(), reverse=True)
    return [
        {
            "site": r["_id"],
            "state": r.get("state") or "new",
            "stateText": STATE_TEXT.get(r.get("state") or "new", r.get("state") or ""),
            "reason": r.get("reason") or "",
            "reasonText": REASONS.get(r.get("reason") or "", "") if r.get("reason") != "job_board" else "",
            "termsUrl": (r.get("terms") or {}).get("url") or "",
            "termsPhrase": (r.get("terms") or {}).get("phrase") or "",
            "firstSeen": ms(r.get("first_seen")),
            "lastTried": ms(r.get("last_tried")),
            "lastOk": ms(r.get("last_ok")),
            "successes": int(r.get("successes") or 0),
            "failures": int(r.get("failures") or 0),
            "today": {"requests": int(r.get("requests_today") or 0), "submits": int(r.get("submits_today") or 0)}
            if r.get("day") == _today()
            else {"requests": 0, "submits": 0},
            "demo": bool(r.get("demo")),
            "resetAt": ms(r.get("reset_at")),
        }
        for r in rows
    ]


async def admin_one_tap(db, key: str, by: str, ip: str | None = None) -> bool:
    r = await db[FORM_SITES].update_one(
        {"_id": key}, {"$set": {"state": "one_tap", "reason": "admin", "stopped_at": now(), "updated_at": now()}}
    )
    if r.matched_count:
        await audit(db, by, "auto_apply.v2_form_site", target=key, data={"to": "one_tap"}, ip=ip)
    return bool(r.matched_count)


async def admin_reset(db, key: str, by: str, ip: str | None = None) -> bool:
    """Back to "not tried yet": robots.txt and the terms are checked again on the next try. A job board stays one."""
    doc = await db[FORM_SITES].find_one({"_id": key}, {"state": 1, "reason": 1})
    if not doc:
        return False
    state = "job_board" if polite.is_job_board(key) else "new"
    await db[FORM_SITES].update_one(
        {"_id": key},
        {"$set": {"state": state, "reason": "job_board" if state == "job_board" else "", "reset_at": now(),
                  "reset_by": by, "updated_at": now()},
         "$unset": {"robots": "", "terms": "", "stopped_at": ""}},
    )  # fmt: skip
    await audit(db, by, "auto_apply.v2_form_site", target=key,
                data={"to": state, "from": doc.get("state"), "was": doc.get("reason")}, ip=ip)  # fmt: skip
    return True


async def counts(db) -> dict[str, int]:
    out = {k: 0 for k in STATE_TEXT}
    async for r in await db[FORM_SITES].aggregate([{"$group": {"_id": "$state", "n": {"$sum": 1}}}]):
        out[r["_id"] or "new"] = r["n"]
    out["appliedToday"] = await db[AUTO_ITEMS].count_documents(
        {"channel_v2": "form", "state": "applied", "counted_day": _today()}
    )
    out["queued"] = await db[AUTO_ITEMS].count_documents({"state": "form_queued"})
    return out
