"""Auto Apply 2.0, phase A5 (open forms): simple application forms on a company's own website, filled from the
candidate's own facts and posted by plain HTTP, politely (robots.txt first, the terms page, an honest user agent, a
delay between requests to a site, daily caps per site); a CAPTCHA or any challenge, a login, 403 / 429, an error or an
unexpected redirect sends the job to one tap and the site is remembered (until Admin resets it); job boards are never
used; anything required Nm7 doesn't know waits for the candidate; the proof is kept and shown in "What was sent"; the
switch OFF keeps real candidates away from real companies' forms; the demo never touches the network. Every HTTP call
goes to an httpx MockTransport (a fake company site)."""

from datetime import timedelta

import httpx
import pytest

from app.autoapply import demo, engine, v2engine
from app.autoapply.forms import page, polite
from app.autoapply.forms import service as forms
from app.core.db import APPLICATIONS, AUDIT_LOG, AUTO_ITEMS, FORM_SITES, JOBS, USERS
from app.site import get_site, save_site
from tests.test_auto_apply_a2 import TEST_CO
from tests.test_auto_apply_engine import no_ai, roomy  # noqa: F401
from tests.test_auto_apply_v2 import EMAIL, V2, run, tester
from tests.test_companies_posting import verified
from tests.test_companies_signup import no_network  # noqa: F401
from tests.test_jobs_public import add

HOST = "https://careers.acme.com"
DESC = "Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome; training is given."
ROBOTS_OK = "User-agent: *\nDisallow: /admin\n"


def form_html(extra: str = "", head: str = "", action: str = "/apply", method: str = "post", fields: str | None = None):
    body = (
        fields
        if fields is not None
        else """
<input type="hidden" name="csrf" value="tok-123">
<label for="n">Full name *</label><input id="n" name="full_name" required>
<label for="e">Email address *</label><input id="e" type="email" name="email" required>
<label>Mobile <input type="tel" name="phone"></label>
<label for="c">Why do you want to work here?</label><textarea id="c" name="cover"></textarea>
<label for="r">Upload your resume / CV *</label><input id="r" type="file" name="resume" required>
<label for="g">Gender</label><select id="g" name="gender"><option value="">Choose</option><option>Female</option>
</select>"""
    )
    return f"""<html><head><title>Data Analyst · Acme</title>{head}</head><body>
<nav><a href="/terms-of-use">Terms of use</a> <a href="/privacy">Privacy</a></nav>
<h1>Junior Data Analyst</h1><form method="{method}" action="{action}" enctype="multipart/form-data">{body}{extra}
<button type="submit">Apply now</button></form></body></html>"""


THANKS = "<html><body><h1>Thank you!</h1><p>We have received your application. We will be in touch.</p></body></html>"
TERMS_OK = "<html><body><p>Use this site fairly. We may change these terms.</p></body></html>"


class FakeSite:
    """A company website: answers by (method, scheme://host/path), remembers every request."""

    def __init__(self):
        self.calls: list[httpx.Request] = []
        self.routes: dict[tuple[str, str], list] = {}

    def on(self, method: str, url: str, *answers):
        self.routes[(method, url)] = list(answers)

    def standard(self, html: str | None = None, robots: str = ROBOTS_OK, post=None):
        self.on("GET", f"{HOST}/robots.txt", (200, robots))
        self.on("GET", f"{HOST}/jobs/da-1", (200, html or form_html()))
        self.on("GET", f"{HOST}/terms-of-use", (200, TERMS_OK))
        self.on("POST", f"{HOST}/apply", post or (303, "", {"location": "/thank-you"}))
        self.on("GET", f"{HOST}/thank-you", (200, THANKS))

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        key = (request.method, f"{request.url.scheme}://{request.url.host}{request.url.path}")
        answers = self.routes.get(key)
        if not answers:
            return httpx.Response(404, text="not found")
        a = answers.pop(0) if len(answers) > 1 else answers[0]
        status, text, *rest = a
        return httpx.Response(status, text=text, headers=rest[0] if rest else {"content-type": "text/html"})

    def posts(self):
        return [c for c in self.calls if c.method == "POST"]


@pytest.fixture
def site(monkeypatch):
    s = FakeSite()
    waits: list[float] = []

    clock = [1000.0]  # time moves only when the polite code waits: the waits are exact, however slow the machine

    async def sleep(x):
        waits.append(x)
        clock[0] += x

    monkeypatch.setattr(polite, "TRANSPORT", httpx.MockTransport(s))
    monkeypatch.setattr(polite, "SLEEP", sleep)
    monkeypatch.setattr(polite, "CLOCK", lambda: clock[0])
    polite._last.clear()
    s.waits = waits
    return s


async def form_job(db, cid, title="Junior Data Analyst", url=f"{HOST}/jobs/da-1", **over):
    j = await add(
        db,
        title=title,
        company={"name": "Acme", "website": "acme.com"},
        applyMethod="link",
        applyUrl=url,
        locations=["Hyderabad"],
        skills=["SQL", "Power BI"],
        description=DESC,
        **over,
    )
    await db[JOBS].update_one({"_id": j["_id"]}, {"$set": {"company_id": cid}})
    return await db[JOBS].find_one({"_id": j["_id"]})


async def setup(client, outbox, db, mode="full_auto", test_company=True):
    uid = await tester(client, outbox, db, mode=mode)
    if test_company:
        await save_site(db, TEST_CO)
    _, cid = await verified(client, outbox, db)
    return uid, cid


async def queued(client, outbox, db, site, **kw):
    """A tester on full auto and one form job on a test company's own site, run: queued for the form pass."""
    uid, cid = await setup(client, outbox, db, **kw)
    j = await form_job(db, cid)
    await run(db, outbox)
    it = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j["_id"]})
    return uid, cid, j, it


async def item_of(db, uid, j):
    return await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j["_id"]})


async def site_doc(db, key="careers.acme.com"):
    return await db[FORM_SITES].find_one({"_id": key}) or {}


# ---------- the whole way: robots, page, terms, fill, post, proof ----------


async def test_simple_form_filled_posted_politely_with_proof(client, outbox, db, site):
    site.standard()
    uid, cid, j, it = await queued(client, outbox, db, site)
    assert it["state"] == "form_queued" and it["channel_v2"] == "form" and it["counted_day"] == engine.today()
    assert not site.calls  # nothing is fetched during the morning run: the background pass does it
    tr = (await client.get(f"{V2}/tracker")).json()
    row = next(x for x in tr["items"] if x["job"]["id"] == j["_id"])
    assert row["stage"] == "ready" and row["channel"] == "form" and row["form"]["text"].startswith("Sending")
    out = await forms.run(db)
    assert out == {"applied": 1}
    it = await item_of(db, uid, j)
    assert it["state"] == "applied" and it["channel_v2"] == "form"
    # the requests: robots.txt first, then the page, the terms, the post and the thank-you page
    paths = [(c.method, c.url.path) for c in site.calls]
    assert paths == [("GET", "/robots.txt"), ("GET", "/jobs/da-1"), ("GET", "/terms-of-use"), ("POST", "/apply"),
                     ("GET", "/thank-you")]  # fmt: skip
    for c in site.calls:
        assert c.headers["user-agent"] == polite.UA == "Nm7-AutoApply/1.0 (+https://nm7.si/bot)"
    # polite: every request after the first waited DELAY (one site, one at a time)
    assert site.waits == [polite.DELAY] * 4
    post = site.posts()[0]
    assert post.headers["referer"] == f"{HOST}/jobs/da-1"
    body = post.content
    assert b'name="full_name"' in body and b"Sai Varsha" in body and EMAIL.encode() in body
    assert b"+91 98765 43210" in body and b'name="csrf"' in body and b"tok-123" in body
    assert b'filename="' in body and b"%PDF" in body  # the tailored resume as a PDF
    assert b"Sent by Nm7 Auto Apply" in body
    assert b'name="gender"' not in body  # never filled from anything but the candidate's own answer
    # the proof: fields sent (the hidden token without its value), the file, status, final address, snapshot
    p = it["form_proof"]
    assert p["ok"] and p["confirmed"] and p["status"] == 200 and p["final_url"] == f"{HOST}/thank-you"
    assert p["page"] == f"{HOST}/jobs/da-1" and p["action"] == f"{HOST}/apply" and p["test"] is True
    assert "Thank you" in p["snapshot"] and len(p["snapshot"]) <= page.SNAPSHOT_MAX
    labels = {f["label"]: f for f in p["fields"]}
    assert labels["Email address"]["value"] == EMAIL and labels["csrf"] == {"label": "csrf", "value": "",
                                                                            "kind": "hidden"}  # fmt: skip
    assert p["file"]["name"].endswith(".pdf") and p["file"]["size"] > 500
    assert "password" not in str(p).lower()
    # the application record and "What was sent"
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": j["_id"]})
    assert app["channel"] == "form" and app["channel_v2"] == "form" and app["v2"] and app["form_proof"]["ok"]
    sent = (await client.get(f"{V2}/sent/{it['_id']}")).json()
    assert sent["wentOut"] and sent["channel"] == "form" and sent["form"]["confirmed"]
    assert sent["form"]["finalUrl"] == f"{HOST}/thank-you" and "received your application" in sent["form"]["snapshot"]
    assert any(f["value"] == EMAIL for f in sent["form"]["fields"])
    tr = (await client.get(f"{V2}/tracker")).json()
    row = next(x for x in tr["items"] if x["job"]["id"] == j["_id"])
    assert row["stage"] == "applied" and row["form"]["text"] == "Sent through the company’s own form"
    # the site: allowed, one success, robots.txt and the terms remembered (not fetched again tomorrow)
    s = await site_doc(db)
    assert s["state"] == "allowed" and s["successes"] == 1 and s["failures"] == 0 and s["last_ok"]
    assert s["terms"]["url"] == f"{HOST}/terms-of-use" and s["terms"]["forbidden"] is False
    assert s["requests_today"] == 5 and s["submits_today"] == 1
    # never twice
    assert await forms.run(db) == {}


# ---------- robots.txt and the terms ----------


@pytest.mark.parametrize(
    "robots",
    [
        "User-agent: *\nDisallow: /jobs/\n",
        "User-agent: Nm7-AutoApply\nDisallow: /\n\nUser-agent: *\nAllow: /\n",  # our own agent named
        "User-agent: *\nDisallow: /apply\n",  # the form's address
    ],
)
async def test_robots_disallow_skips_and_remembers(client, outbox, db, site, robots):
    site.standard(robots=robots)
    uid, cid, j, it = await queued(client, outbox, db, site)
    assert await forms.run(db) == {"one_tap": 1}
    it = await item_of(db, uid, j)
    assert it["state"] == "ready" and it["reason"] == "robots" and it["channel_v2"] == "one_tap"
    assert "counted_day" not in it  # not counted in today's limit
    assert not site.posts()
    s = await site_doc(db)
    assert s["state"] == "robots" and s["reason"] == "robots" and s["failures"] == 1
    # remembered: the next job on that site is one tap at once, without any request
    n = len(site.calls)
    j2 = await form_job(db, cid, title="Data Analyst Trainee", url=f"{HOST}/jobs/da-2")
    await run(db, outbox)
    it2 = await item_of(db, uid, j2)
    assert it2["state"] == "ready" and it2["reason"] == "site_one_tap" and len(site.calls) == n
    row = next(x for x in (await client.get(f"{V2}/tracker")).json()["items"] if x["job"]["id"] == j["_id"])
    assert row["channel"] == "one_tap" and "robots.txt" in row["readyText"]


async def test_robots_forbidden_is_off_limits(client, outbox, db, site):
    site.standard()
    site.on("GET", f"{HOST}/robots.txt", (403, "no"))
    uid, cid, j, it = await queued(client, outbox, db, site)
    await forms.run(db)
    assert (await item_of(db, uid, j))["reason"] == "robots_forbidden"
    assert (await site_doc(db))["state"] == "robots" and [c.url.path for c in site.calls] == ["/robots.txt"]


def test_robots_rules():
    url = f"{HOST}/jobs/1"
    assert polite.robots_allow("", url) and polite.robots_allow(ROBOTS_OK, url)
    assert not polite.robots_allow(None, url)
    assert not polite.robots_allow("User-agent: *\nDisallow: /\n", url)
    assert not polite.robots_allow("User-agent: nm7-autoapply\nDisallow: /jobs\n", url)
    assert polite.robots_allow("User-agent: OtherBot\nDisallow: /\n", url)


async def test_terms_prohibition_skips_and_remembers(client, outbox, db, site):
    site.standard()
    site.on("GET", f"{HOST}/terms-of-use", (200, "<p>Welcome.</p><p>You agree not to use any robot, spider, scraper "
                                                 "or other automated means to access the site.</p>"))  # fmt: skip
    uid, cid, j, it = await queued(client, outbox, db, site)
    assert await forms.run(db) == {"one_tap": 1}
    it = await item_of(db, uid, j)
    assert it["reason"] == "terms" and not site.posts()
    s = await site_doc(db)
    assert s["state"] == "terms" and s["terms"]["forbidden"] and "automated means" in s["terms"]["phrase"]


def test_terms_keywords():
    assert page.terms_forbid("Scraping or crawling this website is prohibited.")
    assert page.terms_forbid("You must not use bots to submit forms.")
    assert page.terms_forbid("No automated access without our prior written permission.")
    assert page.terms_forbid("Automated queries are not permitted.")
    assert not page.terms_forbid("We use automated systems to keep your data safe. Apply for jobs freely.")
    assert not page.terms_forbid("Our robot vacuum products are covered by a warranty.")


# ---------- what stops a form: CAPTCHA, login, steps, payment, JavaScript ----------

WIDGETS = {
    "recaptcha": '<div class="g-recaptcha" data-sitekey="x"></div>',
    "recaptcha_script": '<script src="https://www.google.com/recaptcha/api.js" async></script>',
    "hcaptcha": '<div class="h-captcha" data-sitekey="x"></div><script src="https://hcaptcha.com/1/api.js"></script>',
    "turnstile": '<div class="cf-turnstile" data-sitekey="x"></div>',
    "turnstile_script": '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>',
    "image_captcha": '<img src="/captcha.png"><input name="captcha_code" required>',
    "friendly": '<div class="frc-captcha" data-sitekey="x"></div>',
    "arkose": '<script src="https://client-api.arkoselabs.com/v2/api.js"></script>',
}


@pytest.mark.parametrize("widget", list(WIDGETS))
def test_captcha_widgets_detected(widget):
    html = form_html(extra=WIDGETS[widget])
    pg = page.parse(html)
    assert page.blocker(pg, page.application_form(pg)) == "captcha"


def test_challenge_page_detected():
    assert page.captcha("<html><title>Just a moment...</title><body>Checking your browser</body></html>")
    assert not page.captcha(form_html())


@pytest.mark.parametrize("widget", ["recaptcha", "hcaptcha", "turnstile", "image_captcha"])
async def test_captcha_goes_to_one_tap_and_is_remembered(client, outbox, db, site, widget):
    site.standard(html=form_html(extra=WIDGETS[widget]))
    uid, cid, j, it = await queued(client, outbox, db, site)
    assert await forms.run(db) == {"one_tap": 1}
    it = await item_of(db, uid, j)
    assert it["state"] == "ready" and it["reason"] == "captcha" and not site.posts()
    s = await site_doc(db)
    assert s["state"] == "one_tap" and s["reason"] == "captcha"
    assert await forms.route(db, await db[USERS].find_one({"_id": uid}), j, await get_site(db)) == "site_one_tap"


async def test_captcha_on_the_answer_page_is_remembered(client, outbox, db, site):
    site.standard(post=(200, '<div class="g-recaptcha"></div><p>Please confirm you are human</p>'))
    uid, cid, j, it = await queued(client, outbox, db, site)
    await forms.run(db)
    it = await item_of(db, uid, j)
    assert it["reason"] == "captcha" and it["form_proof"]["ok"] is False and it["form_proof"]["status"] == 200
    assert (await site_doc(db))["state"] == "one_tap"


async def test_login_form_is_never_filled(client, outbox, db, site):
    login = form_html(fields='<input name="username"><input type="password" name="password">')
    site.standard(html=login)
    uid, cid, j, it = await queued(client, outbox, db, site)
    await forms.run(db)
    it = await item_of(db, uid, j)
    assert it["reason"] == "login" and not site.posts()
    assert (await site_doc(db))["reason"] == "login"


async def test_redirect_to_login_or_another_site_is_remembered(client, outbox, db, site):
    site.standard()
    site.on("GET", f"{HOST}/jobs/da-1", (302, "", {"location": "/account/login?next=/jobs/da-1"}))
    uid, cid, j, it = await queued(client, outbox, db, site)
    await forms.run(db)
    assert (await item_of(db, uid, j))["reason"] == "login_redirect"
    assert (await site_doc(db))["state"] == "one_tap"
    assert [c.url.path for c in site.calls] == ["/robots.txt", "/jobs/da-1"]  # the login page is never opened


def test_redirect_hops_are_checked():
    with pytest.raises(forms.Stop) as e:
        forms._check_hop("careers.acme.com", "https://jobs.otherco.com/apply", "")
    assert e.value.reason == "redirect" and e.value.remember == "one_tap"
    with pytest.raises(forms.Stop) as e:
        forms._check_hop("careers.acme.com", "https://www.linkedin.com/jobs/1", "")
    assert e.value.reason == "job_board"
    forms._check_hop("careers.acme.com", "https://www.acme.com/careers/thanks", "")  # same company: fine


@pytest.mark.parametrize(
    "html,why",
    [
        (form_html(extra='<input type="hidden" name="step" value="1">'), "multi_step"),
        (form_html().replace('<button type="submit">Apply now</button>', '<button type="button">Next</button>'),
         "multi_step"),
        (form_html(extra='<div class="wizard-step">1 of 3</div>'), "multi_step"),
        (form_html(extra='<input name="card_number" autocomplete="cc-number">'), "payment"),
        (form_html(extra="<p>Application fee</p>").replace("Apply now", "Pay now"), "payment"),
        (form_html(method="get"), "not_post"),
        (form_html().replace('<form method="post"', '<form onsubmit="return send()" method="post"'), "needs_js"),
        ('<html><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript>'
         "<script src=a.js></script></body></html>", "needs_js"),
    ],
)  # fmt: skip
def test_forms_that_need_more_than_plain_http(html, why):
    pg = page.parse(html)
    assert page.blocker(pg, page.application_form(pg)) == why


def test_newsletter_and_search_boxes_are_not_application_forms():
    html = """<form action="/search"><input name="q"><button>Go</button></form>
    <form action="/news" method="post"><input type="email" name="email"><button>Subscribe</button></form>"""
    assert page.application_form(page.parse(html)) is None


# ---------- 403 / 429 / errors ----------


@pytest.mark.parametrize("status,reason", [(403, "http_403"), (429, "http_429"), (503, "server")])
async def test_blocked_page_goes_to_one_tap_and_is_remembered(client, outbox, db, site, status, reason):
    site.standard()
    site.on("GET", f"{HOST}/jobs/da-1", (status, "go away"))
    uid, cid, j, it = await queued(client, outbox, db, site)
    await forms.run(db)
    it = await item_of(db, uid, j)
    assert it["state"] == "ready" and it["reason"] == reason
    s = await site_doc(db)
    assert s["state"] == "one_tap" and s["reason"] == reason and s["failures"] == 1


@pytest.mark.parametrize("status,reason", [(403, "http_403"), (429, "http_429")])
async def test_blocked_submit_keeps_the_proof(client, outbox, db, site, status, reason):
    site.standard(post=(status, "Too many requests"))
    uid, cid, j, it = await queued(client, outbox, db, site)
    await forms.run(db)
    it = await item_of(db, uid, j)
    assert it["reason"] == reason and it["form_proof"]["ok"] is False and it["form_proof"]["status"] == status
    assert (await site_doc(db))["state"] == "one_tap"
    assert not await db[APPLICATIONS].find_one({"user_id": uid, "job_id": j["_id"]})
    sent = (await client.get(f"{V2}/sent/{it['_id']}")).json()
    assert sent["form"]["ok"] is False and not sent["wentOut"]


async def test_form_shown_again_with_errors_is_remembered(client, outbox, db, site):
    site.standard(post=(200, form_html(extra="<p class=err>Please correct the errors: phone is required</p>")))
    uid, cid, j, it = await queued(client, outbox, db, site)
    await forms.run(db)
    assert (await item_of(db, uid, j))["reason"] == "form_error"
    assert (await site_doc(db))["reason"] == "form_error"


async def test_page_gone_is_not_held_against_the_site(client, outbox, db, site):
    site.standard()
    site.on("GET", f"{HOST}/jobs/da-1", (404, "gone"))
    uid, cid, j, it = await queued(client, outbox, db, site)
    await forms.run(db)
    assert (await item_of(db, uid, j))["reason"] == "page_gone"
    assert (await site_doc(db))["state"] == "new"


# ---------- job boards, hosted forms, other sites ----------


@pytest.mark.parametrize(
    "url",
    [
        "https://www.linkedin.com/jobs/view/1",
        "https://in.linkedin.com/jobs/view/2",
        "https://www.naukri.com/job-listings-1",
        "https://in.indeed.com/viewjob?jk=1",
        "https://www.foundit.in/job/1",
        "https://www.glassdoor.co.in/job/1",
        "https://www.shine.com/jobs/1",
        "https://internshala.com/internship/1",
    ],
)
async def test_job_boards_are_refused(client, outbox, db, site, url):
    uid, cid = await setup(client, outbox, db)
    j = await form_job(db, cid, url=url)
    assert polite.is_job_board(url)
    u = await db[USERS].find_one({"_id": uid})
    assert await forms.route(db, u, j, await get_site(db)) == "job_board"
    with pytest.raises(polite.Refused) as e:
        async with polite.client() as http:
            await polite.request(db, http, "GET", url)
    assert e.value.kind == "job_board" and not site.calls
    assert (await db[FORM_SITES].find_one({"_id": polite.site_of(url)}))["state"] == "job_board"


def test_job_board_matching_is_exact():
    assert not polite.is_job_board("https://myshine.com/careers")
    assert not polite.is_job_board("https://chart.metrics.in/jobs")  # contains "t.me", isn't Telegram
    assert not polite.is_job_board("https://acmex.com/apply")
    assert polite.is_job_board("https://t.me/jobs") and polite.is_job_board("https://x.com/acme")
    assert polite.is_hosted("https://boards.greenhouse.io/acme/jobs/1") and polite.is_hosted("https://forms.gle/x")


async def test_hosted_or_other_site_links_stay_one_tap(client, outbox, db, site):
    uid, cid = await setup(client, outbox, db)
    s = await get_site(db)
    u = await db[USERS].find_one({"_id": uid})
    j = await form_job(db, cid, url="https://acme.myworkdayjobs.com/en-US/careers/job/1")
    assert await forms.route(db, u, j, s) == "hosted"
    j2 = await form_job(db, cid, title="Data Analyst Trainee", url="https://jobs.someoneelse.in/acme/1")
    assert await forms.route(db, u, j2, s) == "not_company_site"
    assert not site.calls


# ---------- polite: spacing, caps, user agent ----------


async def test_polite_spacing_daily_caps_and_user_agent(db, site, monkeypatch):
    site.on("GET", f"{HOST}/a", (200, "a"))
    site.on("GET", "https://www.other.in/a", (200, "b"))
    site.on("POST", f"{HOST}/apply", (200, "ok"))
    for k in ("careers.acme.com", "other.in"):
        await forms._seen(db, k)
    monkeypatch.setattr(polite, "REQUESTS_PER_DAY", 4)
    monkeypatch.setattr(polite, "SUBMITS_PER_DAY", 1)
    async with polite.client() as http:
        await polite.request(db, http, "GET", f"{HOST}/a")
        assert site.waits == []  # the first request to a site doesn't wait
        await polite.request(db, http, "GET", "https://www.other.in/a")
        assert site.waits == []  # another site doesn't wait either
        await polite.request(db, http, "GET", f"{HOST}/a")
        assert site.waits == [polite.DELAY]  # the same site waits
        await polite.request(db, http, "POST", f"{HOST}/apply", submit=True)
        with pytest.raises(polite.Refused) as e:  # one submit a day here
            await polite.request(db, http, "POST", f"{HOST}/apply", submit=True)
        assert e.value.kind == "daily_cap"
        with pytest.raises(polite.Refused) as e:  # 4 requests a day here
            await polite.request(db, http, "GET", f"{HOST}/a")
        assert e.value.kind == "daily_cap"
        await polite.request(db, http, "GET", "https://www.other.in/a")  # the other site has its own allowance
    assert {c.headers["user-agent"] for c in site.calls} == {polite.UA}
    assert len(site.calls) == 5
    assert polite.TIMEOUT.read == 15.0 and polite.TIMEOUT.connect == 10.0


async def test_daily_cap_waits_for_tomorrow(client, outbox, db, site, monkeypatch):
    site.standard()
    uid, cid, j, it = await queued(client, outbox, db, site)
    monkeypatch.setattr(polite, "SUBMITS_PER_DAY", 0)
    assert await forms.run(db) == {"later": 1}
    it = await item_of(db, uid, j)
    assert it["state"] == "form_queued" and not site.calls
    assert it["form_next_at"] > it["created_at"] + timedelta(hours=5)


async def test_private_addresses_are_never_fetched(db, monkeypatch):
    monkeypatch.setattr(polite, "TRANSPORT", None)
    for h in ("localhost", "127.0.0.1", "10.0.0.5", "169.254.169.254", "192.168.1.1", "intranet.local"):
        assert not await polite.public_host(h)
    with pytest.raises(polite.Refused) as e:
        async with polite.client() as http:
            await polite.request(db, http, "GET", "http://169.254.169.254/latest/meta-data")
    assert e.value.kind == "private"


# ---------- filling ----------

FACTS = page.Facts(
    first="Sai", last="Varsha", email="sai@example.com", phone="+91 98765 43210", city="Chennai",
    links={"linkedin": "https://linkedin.com/in/sai-varsha"}, current_company="", current_title="",
    degree="B.Tech Computer Science", college="Lakeview Institute of Technology", grad_year="2025",
    notice="30 days", salary="₹4 L or more", cover="Line one.\nLine two.\nSent by Nm7 Auto Apply for the candidate.",
    job_title="Junior Data Analyst", profile="https://nm7.si/r/sai", saved={}, resume_name="Sai_Varsha_Resume.pdf",
)  # fmt: skip


def _form(fields: str):
    return page.application_form(page.parse(form_html(fields=fields)))


def test_field_mapping_and_file_upload():
    fm = _form("""
<label for="a">First name</label><input id="a" name="fname" required>
<label for="b">Surname</label><input id="b" name="lname" required>
<input type="email" name="applicant_email" placeholder="you@example.com" required>
<label>Phone number<input name="contact_no" required></label>
<label>LinkedIn profile URL<input name="li"></label>
<label>Notice period<select name="notice" required><option value="">-</option><option value="15">15 days</option>
<option value="30">30 days</option></select></label>
<label>Expected CTC<input name="ectc"></label>
<label>Highest qualification<input name="qual"></label>
<label>College / University<input name="college"></label>
<label>Year of passing<input name="yop"></label>
<label>Position applied for<input name="position"></label>
<label>How did you hear about us?<input name="src"></label>
<label>Cover letter<textarea name="cl" maxlength="40"></textarea></label>
<label>Date of birth<input name="dob"></label>
<label>Religion<input name="rel"></label>
<label>CV<input type="file" name="cv_file" accept=".pdf" required></label>
<label>Photo<input type="file" name="photo"></label>""")
    f = page.fill(fm, FACTS, b"%PDF-1.4 resume")
    data = dict(f.data)
    assert data["fname"] == "Sai" and data["lname"] == "Varsha" and data["applicant_email"] == "sai@example.com"
    assert data["contact_no"] == "+91 98765 43210" and data["li"].startswith("https://linkedin.com")
    assert data["notice"] == "30" and data["ectc"] == "₹4 L or more" and data["qual"].startswith("B.Tech")
    assert (
        data["college"].startswith("Lakeview") and data["yop"] == "2025" and data["position"] == "Junior Data Analyst"
    )
    assert data["src"] == "Nm7 (nm7.si)" and data["cl"] == FACTS.cover[:40]
    assert "dob" not in data and "rel" not in data  # sensitive: only ever the candidate's own saved answer
    assert f.files == [("cv_file", ("Sai_Varsha_Resume.pdf", b"%PDF-1.4 resume", "application/pdf"))]
    assert f.missing == [] and not f.needs_file
    assert {p["kind"] for p in f.proof} >= {"profile", "cover", "file"}


def test_unknown_required_fields_become_questions():
    fm = _form("""
<input type="email" name="email" required><label>Full name<input name="name" required></label>
<label>Current CTC (lakhs)<input type="number" name="cctc" required></label>
<label>Gender<select name="g" required><option value="">-</option><option>Female</option><option>Male</option>
</select></label>
<label><input type="checkbox" name="consent" required> I agree to the privacy policy</label>
<fieldset><input type="radio" name="relocate" value="y" aria-label="Willing to relocate" required>
<input type="radio" name="relocate" value="n" aria-label="Willing to relocate" required></fieldset>
<label>Resume<input type="file" name="resume" required></label>""")
    f = page.fill(fm, FACTS, b"%PDF")
    kinds = {q["text"]: q["kind"] for q in f.missing}
    assert kinds == {"Current CTC (lakhs)": "number", "Gender": "choice", "I agree to the privacy policy": "yesno",
                     "Willing to relocate": "choice"}  # fmt: skip
    gender = next(q for q in f.missing if q["text"] == "Gender")
    assert gender["options"] == ["Female", "Male"]
    # the candidate's saved answers fill them next time (sensitive ones too: their own answer)
    given = (("Current CTC (lakhs)", 3), ("Gender", "Female"), ("I agree to the privacy policy", "yes"),
             ("Willing to relocate", "n"))  # fmt: skip
    saved = {engine.norm(t): v for t, v in given}
    f2 = page.fill(fm, page.Facts(**{**FACTS.__dict__, "saved": saved}), b"%PDF")
    d = dict(f2.data)
    assert not f2.missing and d["cctc"] == "3" and d["g"] == "Female" and d["consent"] == "on" and d["relocate"] == "n"


def test_required_file_other_than_resume():
    fm = _form("""<input type="email" name="email" required><label>Name<input name="name" required></label>
<label>Resume<input type="file" name="resume" required></label>
<label>Passport photo<input type="file" name="pic" required></label>""")
    assert page.fill(fm, FACTS, b"%PDF").needs_file


async def test_unknown_required_field_waits_then_goes_on_answer(client, outbox, db, site):
    html = form_html(extra='<label for="x">Current CTC (in lakhs) *</label><input id="x" name="cctc" required>')
    site.standard(html=html)
    uid, cid, j, it = await queued(client, outbox, db, site)
    assert await forms.run(db) == {"needs_answer": 1}
    it = await item_of(db, uid, j)
    assert it["state"] == "needs_answer" and it["kind"] == "form" and "counted_day" not in it
    assert not site.posts()  # never guessed
    w = (await client.get(f"{V2}/waiting")).json()
    row = next(x for x in w if x["job"]["id"] == j["_id"])
    (q,) = row["questions"]
    assert q["text"] == "Current CTC (in lakhs)" and q["kind"] == "text"
    r = await client.post(f"{V2}/waiting/{it['_id']}/answer", json={"answers": {q["id"]: ""}})
    assert r.status_code == 400
    r = await client.post(f"{V2}/waiting/{it['_id']}/answer", json={"answers": {q["id"]: "3.5"}})
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "form_queued"
    u = await db[USERS].find_one({"_id": uid})
    assert u["auto_apply"]["answers"][engine.norm("Current CTC (in lakhs)")] == "3.5"  # saved: never asked again
    await forms.run(db)  # (the answer's background kick may already have sent it)
    it = await item_of(db, uid, j)
    assert it["state"] == "applied"
    assert b'name="cctc"\r\n\r\n3.5' in site.posts()[-1].content
    assert any(f["label"] == "Current CTC (in lakhs)" and f["kind"] == "saved" for f in it["form_proof"]["fields"])


# ---------- the switch, approvals, Admin, demo ----------


async def test_switch_off_never_a_real_company_form(client, outbox, db, site):
    uid, cid = await setup(client, outbox, db, test_company=False)  # no tester on the company's team
    j = await form_job(db, cid)
    await run(db, outbox)
    it = await item_of(db, uid, j)
    assert it["state"] == "ready" and it["reason"] == "switch_off" and it["channel_v2"] == "one_tap"
    assert await forms.run(db) == {} and not site.calls
    row = next(x for x in (await client.get(f"{V2}/tracker")).json()["items"] if x["job"]["id"] == j["_id"])
    assert row["readyText"] is None  # one tap as before, nothing to explain
    # a job the collector found (no company on Nm7): never while OFF; after launch the rules decide
    col = await add(db, title="Data Analyst Fresher", company={"name": "Zeta", "website": "zeta.in"},
                    applyUrl="https://zeta.in/careers/1")  # fmt: skip
    u = await db[USERS].find_one({"_id": uid})
    assert await forms.route(db, u, col, await get_site(db)) == "switch_off"
    await save_site(db, {"auto_apply_v2": {"testers": [EMAIL], "public": True}})
    assert await forms.route(db, u, col, await get_site(db)) is None
    # a real company's job reached by a queued item while the switch went back OFF: checked again, never sent
    await save_site(db, {"auto_apply_v2": {"testers": [EMAIL], "public": False}})
    await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"state": "form_queued", "form_next_at": it[
        "updated_at"], "form_site": "careers.acme.com", "copy_id": it.get("copy_id")}})  # fmt: skip
    assert await forms.run(db) == {"one_tap": 1} and not site.calls


async def test_approve_each_goes_through_the_form_after_approval(client, outbox, db, site):
    site.standard()
    uid, cid, j, it = await queued(client, outbox, db, site, mode="approve")
    assert it["state"] == "waiting_approval" and it["channel_v2"] == "form"
    r = await client.post(f"{V2}/approve/{it['_id']}")
    assert r.status_code == 200 and r.json()["state"] == "form_queued"
    await forms.run(db)  # (the approval's background kick may already have sent it)
    assert (await item_of(db, uid, j))["state"] == "applied" and len(site.posts()) == 1


async def test_admin_site_list_one_tap_and_reset(client, outbox, db, site, admin_client):
    site.standard(html=form_html(extra=WIDGETS["recaptcha"]))
    uid, cid, j, it = await queued(client, outbox, db, site)
    await forms.run(db)
    await forms._seen(db, "jobs.goodco.in")
    owner = await admin_client("owner")
    d = (await owner.get("/api/admin/auto-apply/v2/forms")).json()
    assert d["rules"]["userAgent"] == polite.UA and d["rules"]["delay"] == polite.DELAY
    row = next(s for s in d["sites"] if s["site"] == "careers.acme.com")
    assert row["state"] == "one_tap" and row["reason"] == "captcha" and "CAPTCHA" in row["reasonText"]
    assert row["failures"] == 1 and row["successes"] == 0 and row["lastTried"] and row["stateText"] == "One tap only"
    assert d["counts"]["one_tap"] >= 1
    assert "txt" not in str(d)  # robots.txt bodies stay on the server
    # reset: tried again from scratch (robots.txt and the terms checked again)
    r = await owner.post("/api/admin/auto-apply/v2/forms/sites/careers.acme.com/reset")
    assert r.status_code == 200 and r.json()["state"] == "new"
    s = await site_doc(db)
    assert s["state"] == "new" and "robots" not in s and "terms" not in s and s["reset_at"]
    u = await db[USERS].find_one({"_id": uid})
    assert await forms.route(db, u, j, await get_site(db)) is None
    # Admin moves a site to one tap
    r = await owner.post("/api/admin/auto-apply/v2/forms/sites/jobs.goodco.in/one-tap")
    assert r.status_code == 200
    assert (await site_doc(db, "jobs.goodco.in"))["reason"] == "admin"
    assert (await owner.post("/api/admin/auto-apply/v2/forms/sites/nope.example/reset")).status_code == 404
    acts = [a["data"] async for a in db[AUDIT_LOG].find({"action": "auto_apply.v2_form_site"})]
    assert {"to": "new", "from": "one_tap", "was": "captcha"} in acts and {"to": "one_tap"} in acts
    # a job board stays a job board after a reset
    await forms._seen(db, "naukri.com", state="job_board", reason="job_board")
    await owner.post("/api/admin/auto-apply/v2/forms/sites/naukri.com/reset")
    assert (await site_doc(db, "naukri.com"))["state"] == "job_board"
    # not for candidates
    assert (await client.get("/api/admin/auto-apply/v2/forms")).status_code in (401, 403)


async def test_demo_shows_a_form_application_with_proof_and_no_network(db, monkeypatch):
    calls = []

    def boom(request):
        calls.append(request)
        raise httpx.ConnectError("no network in the demo")

    monkeypatch.setattr(polite, "TRANSPORT", httpx.MockTransport(boom))
    await demo.create(db)
    it = await db[AUTO_ITEMS].find_one({"user_id": demo.STUDENT_ID, "channel_v2": "form"})
    assert it and it["state"] == "applied" and it["form_proof"]["ok"] and it["form_proof"]["confirmed"]
    assert "Thank you" in it["form_proof"]["snapshot"]
    assert any(f["value"] for f in it["form_proof"]["fields"] if f["label"] == "Email")
    out = await v2engine.what_was_sent(db, demo.STUDENT_ID, it["_id"])
    assert out["form"]["file"]["name"].endswith(".pdf") and out["channel"] == "form"
    assert (await db[FORM_SITES].find_one({"_id": demo.DEMO_SITE}))["demo"] is True
    u = await db[USERS].find_one({"_id": demo.STUDENT_ID})
    j = await db[JOBS].find_one({"_id": "demo-tech-solutions-job-form"})
    assert await forms.route(db, u, j, await get_site(db)) == "demo"
    await forms.run(db)
    assert not calls
    await demo.remove(db)
    assert not await db[FORM_SITES].find_one({"_id": demo.DEMO_SITE})
