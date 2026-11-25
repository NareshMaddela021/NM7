"""Auto Apply 2.0, phase A6 (one tap): the apply kit per Ready job (the tailored resume PDF, the cover note, the ready
answers and the candidate's own facts, with the job's apply link); the morning "N jobs ready" list (in-app, email only
through may_mail); "I applied" → Applied with the One tap channel; one reminder the next day, once; "Not applying";
closed and dead-link jobs never offered (a job that closes after it was listed shows as Closed); the Nm7 Apply helper's
pairing code (10 minutes, one use) and its token (revocable, scoped to reading kits and marking applied, nothing else);
everything behind the 2.0 switch; Kavya's morning list in the demo."""

import re
from datetime import timedelta
from pathlib import Path

import pytest

from app.autoapply import demo, onetap
from app.autoapply.forms import polite
from app.core.db import (
    APPLICATIONS,
    AUDIT_LOG,
    AUTO_ITEMS,
    AUTO_MORNINGS,
    HELPER_CODES,
    HELPER_TOKENS,
    JOBS,
    RATE_EVENTS,
    USERS,
)
from app.core.time import ist_day, now
from app.site import save_site
from tests.conftest import signup
from tests.test_auto_apply_engine import no_ai, roomy  # noqa: F401
from tests.test_auto_apply_v2 import EMAIL, V2, run, tester
from tests.test_companies_signup import no_network  # noqa: F401
from tests.test_jobs_public import add

DESC = "Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome; training is given."
OT = f"{V2}/onetap"
HELPER = "/api/helper"
ROOT = Path(__file__).resolve().parents[2]


async def site_job(db, title="Junior Data Analyst", url="https://zeta.in/careers/da-1", **over):
    """A job the collector found on a company's own site (no company on Nm7): while the switch is OFF it is never
    sent for the candidate, so it is Ready for one tap."""
    co = {"name": "Zeta Retail", "website": "zeta.in"}
    return await add(db, title=title, company=co, applyMethod="link", applyUrl=url, locations=["Hyderabad"],
                     skills=["SQL", "Power BI"], description=DESC, **over)  # fmt: skip


async def ready(client, outbox, db, n=2):
    uid = await tester(client, outbox, db, mode="full_auto")
    jobs = [await site_job(db, title=t, url=f"https://zeta.in/careers/{i}") for i, t in enumerate(
        ["Junior Data Analyst", "Data Analyst Fresher", "SQL Data Analyst"][:n])]  # fmt: skip
    await run(db, outbox)
    items = [await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": j["_id"]}) for j in jobs]
    assert all(it and it["state"] == "ready" for it in items), [it and it["state"] for it in items]
    return uid, jobs, items


def morning_mails(outbox):
    return [m for m in outbox.sent if re.fullmatch(r"\d+ jobs? ready to apply", m.subject)]


def ok(r):
    assert r.status_code == 200, r.text
    return r.json()


async def paired(client, make_client):
    code = ok(await client.post(f"{V2}/helper/code"))["code"]
    ext = make_client()
    got = ok(await ext.post(f"{HELPER}/pair", json={"code": code, "device": "Chrome on Android"}))
    ext.headers["Authorization"] = f"Bearer {got['token']}"
    ext.headers.pop("Origin", None)
    return ext, got


# ---------- the kit ----------


async def test_kit_has_the_tailored_resume_cover_note_answers_and_link(client, outbox, db):
    uid, jobs, items = await ready(client, outbox, db)
    d = ok(await client.get(OT))
    assert d["open"] == 2 and d["morning"]["count"] == 2 and d["morning"]["seen"] is False
    card = next(c for c in d["items"] if c["id"] == items[0]["_id"])
    assert card["applyUrl"] == jobs[0]["apply"]["url"] and card["applyHost"] == "zeta.in" and not card["closed"]
    assert card["listedToday"] and card["stage"] == "ready"
    k = ok(await client.get(f"{OT}/{items[0]['_id']}/kit"))
    assert k["applyUrl"] == "https://zeta.in/careers/0" and k["job"]["company"] == "Zeta Retail"
    assert k["resume"]["name"].endswith("_Resume.pdf")
    assert k["coverNote"] and "Sent by Nm7" not in k["coverNote"]  # the candidate applies themselves
    assert k["answers"] and all(a["question"] and a["answer"] for a in k["answers"])
    f = {x["key"]: x["value"] for x in k["fields"]}
    assert f["email"] == EMAIL and f["full_name"] and f["first_name"]
    u = await db[USERS].find_one({"_id": uid})
    assert f["full_name"].split()[0] in (u["name"], *u["name"].split())
    assert all(x["value"].strip() for x in k["fields"])  # only what the candidate has; nothing made up
    r = await client.get(f"{OT}/{items[0]['_id']}/resume.pdf")
    assert r.status_code == 200 and r.content.startswith(b"%PDF") and "attachment" in r.headers["content-disposition"]
    assert ok(await client.post(f"{OT}/seen"))["seen"] is True
    assert ok(await client.get(OT))["morning"]["seen"] is True
    # someone else's kit: not found
    other = await db[AUTO_ITEMS].insert_one({**items[1], "_id": "x-other", "user_id": "someone-else", "job_id": "j"})
    assert (await client.get(f"{OT}/{other.inserted_id}/kit")).status_code == 404


# ---------- closed jobs ----------


async def test_closed_and_dead_jobs_are_never_offered(client, outbox, db, make_client):
    uid = await tester(client, outbox, db, mode="full_auto")
    good = await site_job(db, url="https://zeta.in/careers/good")
    dead = await site_job(db, title="Data Analyst Fresher", url="https://zeta.in/careers/dead")
    await db[JOBS].update_one({"_id": dead["_id"]}, {"$set": {"link_check": {"ok": False, "fails": 1, "status": 404}}})
    await run(db, outbox)
    assert not await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": dead["_id"]})  # never even made Ready
    it = await db[AUTO_ITEMS].find_one({"user_id": uid, "job_id": good["_id"]})
    m = await db[AUTO_MORNINGS].find_one({"_id": f"{uid}:{ist_day()}"})
    assert m["items"] == [it["_id"]]
    # at morning build: a Ready kit whose link died since is left out of the list
    late = await site_job(db, title="SQL Data Analyst", url="https://zeta.in/careers/late")
    copy = {k: v for k, v in it.items() if k not in ("_id", "job_id")}
    await db[AUTO_ITEMS].insert_one({**copy, "_id": "late-item", "job_id": late["_id"], "title": late["title"]})
    await db[JOBS].update_one({"_id": late["_id"]}, {"$set": {"link_check": {"ok": False, "fails": 2}}})
    await db[AUTO_MORNINGS].delete_many({})
    u = await db[USERS].find_one({"_id": uid})
    from app.site import get_site

    assert await onetap.morning(db, u, await get_site(db), ist_day()) == 1
    assert (await db[AUTO_MORNINGS].find_one({"_id": f"{uid}:{ist_day()}"}))["items"] == [it["_id"]]
    ext, _ = await paired(client, make_client)
    assert [x["id"] for x in ok(await ext.get(f"{HELPER}/kits"))["items"]] == [it["_id"]]
    assert (await ext.get(f"{HELPER}/kits/late-item")).status_code == 409
    # after it was listed the company closes the job: shown as Closed, no Apply now, not in the helper
    await db[JOBS].update_one({"_id": good["_id"]}, {"$set": {"status": "closed"}})
    d = ok(await client.get(OT))
    card = next(c for c in d["items"] if c["id"] == it["_id"])
    assert card["closed"] and card["applyUrl"] == "" and "closed" in card["closedText"].lower()
    assert d["open"] == 0 and d["morning"]["count"] == 0 and d["items"][-1]["closed"]
    assert ok(await ext.get(f"{HELPER}/kits"))["items"] == []
    assert (await ext.get(f"{HELPER}/kits/{it['_id']}")).status_code == 409
    # the run's own cleanup (expired) still shows it as Closed today, because it was on this morning's list
    await db[AUTO_ITEMS].update_one({"_id": it["_id"]}, {"$set": {"state": "expired"}})
    card = next(c for c in ok(await client.get(OT))["items"] if c["id"] == it["_id"])
    assert card["closed"] and card["stage"] == "closed"
    # a closing date that passed
    await db[JOBS].update_one({"_id": late["_id"]}, {"$set": {"link_check": {"ok": True, "fails": 0},
                                                            "closes_at": now() - timedelta(hours=1)}})  # fmt: skip
    assert onetap.closed_reason(await db[JOBS].find_one({"_id": late["_id"]})) == "past_date"


# ---------- the morning list and its notification ----------


async def test_morning_list_once_a_day_in_app_and_email_only_by_may_mail(client, outbox, db, admin_client):
    uid, jobs, items = await ready(client, outbox, db)
    mails = morning_mails(outbox)
    assert len(mails) == 1 and mails[0].to == EMAIL and "2 jobs ready to apply" == mails[0].subject
    assert "/me/auto-apply/v2?tab=ready" in mails[0].text
    m = await db[AUTO_MORNINGS].find_one({"_id": f"{uid}:{ist_day()}"})
    assert m["count"] == 2 and m["mailed_at"] and set(m["items"]) == {i["_id"] for i in items}
    for i in items:
        assert (await db[AUTO_ITEMS].find_one({"_id": i["_id"]}))["remind_at"]
    await run(db, outbox)  # the same day again: no second list, no second email
    assert len(morning_mails(outbox)) == 1
    assert await db[AUTO_MORNINGS].count_documents({"user_id": uid}) == 1
    # not a listed tester (here: an admin's view of may_mail, a demo account): in-app only, never an email
    from app.autoapply import access

    v2 = {"public": False, "testers": [EMAIL]}
    assert access.may_mail({"email": EMAIL}, v2) and not access.may_mail({"email": "boss@nm7.si", "role": "admin"}, v2)
    assert not access.may_mail({"email": EMAIL, "demo": True}, v2)
    await db[AUTO_MORNINGS].delete_many({})
    await save_site(db, {"auto_apply_v2": {"testers": ["someone@else.in"], "public": False}})
    await db[USERS].update_one({"_id": uid}, {"$set": {"role": "admin"}})  # still sees 2.0 (an admin) …
    u = await db[USERS].find_one({"_id": uid})
    from app.site import get_site

    assert await onetap.morning(db, u, await get_site(db), ist_day(), outbox) == 2
    assert len(morning_mails(outbox)) == 1  # … but gets no email
    assert not (await db[AUTO_MORNINGS].find_one({"_id": f"{uid}:{ist_day()}"}))["mailed_at"]
    # "Stop these emails" is respected too
    await db[AUTO_MORNINGS].delete_many({})
    await save_site(db, {"auto_apply_v2": {"testers": [EMAIL], "public": False}})
    await db[USERS].update_one({"_id": uid}, {"$set": {"role": "customer", "notify.email.autoapply": False}})
    u = await db[USERS].find_one({"_id": uid})
    assert await onetap.morning(db, u, await get_site(db), ist_day(), outbox) == 2
    assert len(morning_mails(outbox)) == 1


# ---------- I applied, the reminder, Not applying ----------


async def test_i_applied_moves_the_tracker_to_applied_one_tap(client, outbox, db):
    uid, jobs, items = await ready(client, outbox, db)
    iid = items[0]["_id"]
    assert ok(await client.post(f"{OT}/{iid}/opened"))["opened"] is True
    got = ok(await client.post(f"{OT}/{iid}/applied"))
    assert got == {"state": "applied", "stage": "applied", "channel": "one_tap"}
    row = next(x for x in ok(await client.get(f"{V2}/tracker"))["items"] if x["id"] == iid)
    assert row["stage"] == "applied" and row["channel"] == "one_tap"
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": jobs[0]["_id"]})
    assert app["channel_v2"] == "one_tap" and app["v2"] and app["origin"] == "auto" and app["status"] == "applied"
    assert app["one_tap"]["via"] == "page" and app["channel"] == "link" and app["copy_id"] == items[0]["copy_id"]
    it = await db[AUTO_ITEMS].find_one({"_id": iid})
    assert it["state"] == "applied" and "remind_at" not in it and not it.get("counted_day")  # not in the daily limit
    assert (await client.post(f"{OT}/{iid}/applied")).status_code == 404  # once
    assert iid not in [c["id"] for c in ok(await client.get(OT))["items"]]
    assert await db[AUDIT_LOG].count_documents({"action": "auto_apply.v2_one_tap_applied"}) == 1
    # the candidate can still mark a reply from outside Nm7 on it
    assert ok(await client.post(f"{V2}/tracker/{iid}/status", json={"status": "interview"}))["stage"] == "replied"


async def test_one_reminder_the_next_day_then_it_stays_ready(client, outbox, db):
    uid, jobs, items = await ready(client, outbox, db)
    iid = items[0]["_id"]
    assert await onetap.run(db) == {"reminded": 0, "skipped": 0}  # not yet: tomorrow
    await db[AUTO_ITEMS].update_many({"user_id": uid}, {"$set": {"remind_at": now() - timedelta(minutes=1)}})
    await db[AUTO_ITEMS].update_one({"_id": items[1]["_id"]}, {"$set": {"state": "applied"}})  # confirmed: no reminder
    assert await onetap.run(db) == {"reminded": 1, "skipped": 0}
    it = await db[AUTO_ITEMS].find_one({"_id": iid})
    assert it["state"] == "ready" and it["reminded_at"] and it["notice"]["status"] == "remind"
    assert "Did you apply" in it["notice"]["text"] and "I applied" in it["notice"]["text"]
    upd = ok(await client.get(f"{V2}/tracker"))["updates"]
    assert [u["status"] for u in upd] == ["remind"]
    assert await onetap.run(db) == {"reminded": 0, "skipped": 0}  # once
    await db[AUTO_ITEMS].update_one({"_id": iid}, {"$set": {"remind_at": now() - timedelta(days=3)}})
    assert await onetap.run(db) == {"reminded": 0, "skipped": 0}  # still once
    card = next(c for c in ok(await client.get(OT))["items"] if c["id"] == iid)
    assert card["stage"] == "ready" and card["reminded"] and not card["closed"]
    # "Apply now" on a kit never listed starts the reminder from that tap
    unset = {"remind_at": "", "reminded_at": ""}
    await db[AUTO_ITEMS].update_one({"_id": items[1]["_id"]}, {"$set": {"state": "ready"}, "$unset": unset})
    await client.post(f"{OT}/{items[1]['_id']}/opened")
    it2 = await db[AUTO_ITEMS].find_one({"_id": items[1]["_id"]})
    assert it2["opened_at"] and it2["remind_at"] > now() + timedelta(hours=23)
    # closed jobs and people the switch no longer lets in get no reminder
    await db[AUTO_ITEMS].update_one({"_id": items[1]["_id"]}, {"$set": {"remind_at": now() - timedelta(minutes=1)}})
    await db[JOBS].update_one({"_id": jobs[1]["_id"]}, {"$set": {"status": "closed"}})
    assert await onetap.run(db) == {"reminded": 0, "skipped": 1}


async def test_not_applying_hides_the_kit(client, outbox, db):
    uid, jobs, items = await ready(client, outbox, db)
    iid = items[0]["_id"]
    assert ok(await client.post(f"{OT}/{iid}/dismiss")) == {"state": "skipped"}
    assert iid not in [c["id"] for c in ok(await client.get(OT))["items"]]
    assert iid not in [x["id"] for x in ok(await client.get(f"{V2}/tracker"))["items"]]
    it = await db[AUTO_ITEMS].find_one({"_id": iid})
    assert it["state"] == "skipped" and it["reason"] == "not_applying"
    assert (await client.post(f"{OT}/{iid}/applied")).status_code == 404
    assert (await client.post(f"{OT}/{iid}/dismiss")).status_code == 404


# ---------- the helper: pairing code and token ----------


async def test_pairing_code_is_short_lived_and_works_once(client, outbox, db, make_client):
    await ready(client, outbox, db, n=1)
    code = ok(await client.post(f"{V2}/helper/code"))
    assert re.fullmatch(r"[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}", code["code"]) and code["minutes"] == 10
    assert code["expiresAt"] - int(now().timestamp() * 1000) <= 10 * 60 * 1000 + 1000
    stored = await db[HELPER_CODES].find_one({})
    assert code["code"].replace("-", "") not in str(stored)  # only a keyed hash is stored
    ext = make_client()
    assert (await ext.post(f"{HELPER}/pair", json={"code": "ABCD-EFGH"})).status_code == 400
    got = ok(await ext.post(f"{HELPER}/pair", json={"code": code["code"].lower().replace("-", " ")}))
    assert got["token"].startswith("nm7h_") and got["scope"] == list(onetap.SCOPE)
    assert got["expiresAt"] - int(now().timestamp() * 1000) <= 30 * 86400 * 1000 + 1000
    assert (await ext.post(f"{HELPER}/pair", json={"code": code["code"]})).status_code == 400  # one use
    tok = await db[HELPER_TOKENS].find_one({})
    assert got["token"] not in str(tok)  # only a keyed hash is stored
    # an expired code
    c2 = ok(await client.post(f"{V2}/helper/code"))
    await db[HELPER_CODES].update_many({}, {"$set": {"expires_at": now() - timedelta(seconds=1)}})
    r = await ext.post(f"{HELPER}/pair", json={"code": c2["code"]})
    assert r.status_code == 400 and "10 minutes" in r.json()["error"]["message"]
    # a new code replaces the old one
    c3 = ok(await client.post(f"{V2}/helper/code"))
    c4 = ok(await client.post(f"{V2}/helper/code"))
    assert (await ext.post(f"{HELPER}/pair", json={"code": c3["code"]})).status_code == 400
    assert (await ext.post(f"{HELPER}/pair", json={"code": c4["code"]})).status_code == 200
    # guessing is rate limited
    for _ in range(12):
        r = await ext.post(f"{HELPER}/pair", json={"code": "ZZZZ-ZZZZ"})
    assert r.status_code == 429


async def test_helper_token_is_scoped_revocable_and_does_nothing_else(client, outbox, db, make_client):
    uid, jobs, items = await ready(client, outbox, db)
    ext, got = await paired(client, make_client)
    me = ok(await ext.get(f"{HELPER}/me"))
    assert me["firstName"] == "Sai" and me["scope"] == list(onetap.SCOPE)
    kits = ok(await ext.get(f"{HELPER}/kits"))["items"]
    assert {k["id"] for k in kits} == {i["_id"] for i in items} and kits[0]["applyHost"] == "zeta.in"
    k = ok(await ext.get(f"{HELPER}/kits/{items[0]['_id']}"))
    assert k["fields"] and k["coverNote"] and k["resume"]
    pdf = await ext.get(f"{HELPER}/kits/{items[0]['_id']}/resume.pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    # nothing else on Nm7 accepts it: not as a bearer header, not as the session cookie
    for path in (V2, OT, f"{V2}/tracker", "/api/me/state", "/api/auth/me", f"{V2}/helper"):
        assert (await ext.get(path)).status_code == 401, path
    raw = make_client()
    raw.cookies.set("nm7_session", got["token"])
    assert (await raw.get("/api/auth/me")).status_code == 401
    assert (await ext.post(f"{OT}/{items[0]['_id']}/applied")).status_code == 401
    assert (await ext.post(f"{V2}/approve-all")).status_code == 401
    # without a token, or a made-up one
    bare = make_client()
    assert (await bare.get(f"{HELPER}/kits")).status_code == 401
    bare.headers["Authorization"] = "Bearer nm7h_madeup"
    assert (await bare.get(f"{HELPER}/kits")).status_code == 401
    # another candidate's kit
    await db[AUTO_ITEMS].insert_one({**items[1], "_id": "theirs", "user_id": "someone-else", "job_id": "zz"})
    assert (await ext.get(f"{HELPER}/kits/theirs")).status_code == 404
    assert (await ext.post(f"{HELPER}/kits/theirs/applied")).status_code == 404
    # a read-only token can't mark applied
    await db[HELPER_TOKENS].update_one({}, {"$set": {"scope": ["kits:read"]}})
    assert (await ext.post(f"{HELPER}/kits/{items[0]['_id']}/applied")).status_code == 403
    await db[HELPER_TOKENS].update_one({}, {"$set": {"scope": list(onetap.SCOPE)}})
    # marks applied (the candidate pressed Submit themselves): channel One tap, via the helper
    assert ok(await ext.post(f"{HELPER}/kits/{items[0]['_id']}/applied"))["channel"] == "one_tap"
    app = await db[APPLICATIONS].find_one({"user_id": uid, "job_id": jobs[0]["_id"]})
    assert app["one_tap"]["via"] == "helper" and app["channel_v2"] == "one_tap"
    # the page lists paired browsers and signs one out
    dev = ok(await client.get(f"{V2}/helper"))["devices"]
    assert len(dev) == 1 and dev[0]["device"] == "Chrome on Android"
    assert ok(await client.delete(f"{V2}/helper/{dev[0]['id']}"))["revoked"] == dev[0]["id"]
    assert (await ext.get(f"{HELPER}/kits")).status_code == 401
    assert (await client.delete(f"{V2}/helper/{dev[0]['id']}")).status_code == 404
    # an expired token, and the helper signing itself out
    ext2, _ = await paired(client, make_client)
    assert ok(await ext2.post(f"{HELPER}/unpair"))["revoked"] is True
    assert (await ext2.get(f"{HELPER}/kits")).status_code == 401
    ext3, _ = await paired(client, make_client)
    await db[HELPER_TOKENS].update_many({"revoked_at": None}, {"$set": {"expires_at": now() - timedelta(seconds=1)}})
    assert (await ext3.get(f"{HELPER}/kits")).status_code == 401
    # at most 5 browsers: the oldest is signed out
    for _ in range(6):
        await db[AUDIT_LOG].delete_many({})
        await db[RATE_EVENTS].delete_many({})
        await paired(client, make_client)
    assert len(ok(await client.get(f"{V2}/helper"))["devices"]) == 5


# ---------- the switch ----------


async def test_switch_off_keeps_everyone_else_out(client, outbox, db, make_client):
    uid, jobs, items = await ready(client, outbox, db, n=1)
    ext, _ = await paired(client, make_client)
    # the tester is taken off the list while the switch is OFF: the page and the helper answer 404
    await save_site(db, {"auto_apply_v2": {"testers": [], "public": False}})
    for path in (OT, f"{OT}/{items[0]['_id']}/kit", f"{V2}/helper"):
        assert (await client.get(path)).status_code == 404, path
    for path in (f"{OT}/{items[0]['_id']}/applied", f"{OT}/{items[0]['_id']}/dismiss", f"{V2}/helper/code"):
        assert (await client.post(path)).status_code == 404, path
    assert (await ext.get(f"{HELPER}/kits")).status_code == 404
    assert (await ext.post(f"{HELPER}/kits/{items[0]['_id']}/applied")).status_code == 404
    # nor can a fresh code be used by someone the switch doesn't let in
    await save_site(db, {"auto_apply_v2": {"testers": [EMAIL], "public": False}})
    code = ok(await client.post(f"{V2}/helper/code"))["code"]
    await save_site(db, {"auto_apply_v2": {"testers": [], "public": False}})
    assert (await make_client().post(f"{HELPER}/pair", json={"code": code})).status_code == 404
    # a real user who never was a tester: nothing, and no morning list from the 1.0 run
    other = make_client()
    await signup(other, outbox, email="ravi@example.com", name="Ravi Kumar")
    assert (await other.get(OT)).status_code == 404
    assert (await other.post(f"{V2}/helper/code")).status_code == 404
    assert await db[AUTO_MORNINGS].count_documents({"user_id": {"$ne": uid}}) == 0
    # the reminder pass skips the tester now that the switch leaves them out
    await db[AUTO_ITEMS].update_many({"user_id": uid}, {"$set": {"remind_at": now() - timedelta(minutes=1)}})
    assert await onetap.run(db) == {"reminded": 0, "skipped": 1}


@pytest.mark.parametrize("site_on", [False])
async def test_everything_stops_while_auto_apply_is_off_for_everyone(client, outbox, db, site_on):
    uid, jobs, items = await ready(client, outbox, db, n=1)
    await save_site(db, {"auto_apply": {"on": site_on}})
    await db[AUTO_ITEMS].update_many({"user_id": uid}, {"$set": {"remind_at": now() - timedelta(minutes=1)}})
    assert await onetap.run(db) == {"off": True}


# ---------- the demo ----------


async def test_demo_kavya_has_a_morning_list_with_kits(db):
    await demo.create(db)
    d = await onetap.listing(db, demo.STUDENT_ID)
    assert d["morning"]["listed"] == 4 and d["morning"]["count"] == d["open"] == 3
    closed = [c for c in d["items"] if c["closed"]]
    assert len(closed) == 1 and closed[0]["job"]["title"] == "MIS Analyst" and closed[0]["applyUrl"] == ""
    u = await db[USERS].find_one({"_id": demo.STUDENT_ID})
    for c in d["items"]:
        it = await db[AUTO_ITEMS].find_one({"_id": c["id"]})
        k = await onetap.kit(db, u, it, await db[JOBS].find_one({"_id": it["job_id"]}))
        assert k["coverNote"] and k["resume"] and any(f["key"] == "email" for f in k["fields"])
        assert c["closed"] or k["applyUrl"].startswith("https://demotech.demo.nm7.invalid/careers")
    await demo.create(db)  # a reset starts the list again
    assert await db[AUTO_MORNINGS].count_documents({"user_id": demo.STUDENT_ID}) == 1


# ---------- the extension's job-board list matches the server's ----------


def test_extension_blocklist_covers_every_job_board():
    js = (ROOT / "extension" / "src" / "blocklist.js").read_text()
    array = js.split("const JOB_BOARDS = [", 1)[1].split("];", 1)[0]
    listed = set(re.findall(r"'([^']+)'", array))
    missing = [b for b in polite.JOB_BOARDS if b not in listed]
    assert not missing, missing
