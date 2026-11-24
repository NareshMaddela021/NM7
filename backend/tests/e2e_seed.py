"""Test data for the browser end-to-end tests (frontend/e2e-live). Only touches a database whose name ends in _e2e.

MONGODB_DB=nm7_e2e uv run python -m tests.e2e_seed reset
... admin EMAIL ROLE PASSWORD          → {"secret": "..."} (authenticator key)
... customer EMAIL NAME PASSWORD       → {"id": "..."}
... expert EMAIL NAME PASSWORD STATUS  → {"id": "..."}
... paid-order EMAIL PLAN              → {"id": "RS-…"} (as if Razorpay had confirmed the payment)
... customer-order EMAIL PLAN         → the checkout answer (a customer order waiting for Razorpay's webhook)
... org-order ORG_ID PLAN EMAIL [REF]  → the checkout answer (an org order waiting for Razorpay's webhook), made
                                          without calling Razorpay (the browser tests run without Razorpay keys)
... company-verify COMPANY_ID              → {"ok": true} (as if an admin approved it: Verified for a year)
... job JSON [STATUS] [AGE_HOURS]       → {"id", "slug"} (a job-board job, as an admin would add it)
... aa2-tester EMAIL                   → Auto Apply 2.0 shown to this email while hidden
... trust-agent-person EMAIL PHONE     → T5: that person's mobile number, an adult age check and a resume (no consent)
... trust-t11-book EMAIL CID JOB      → T11: a shortlisted application + its one-tap booking link token
... trust-t11-offer EMAIL CID DAYS BY [LANG] → T11: an accepted offer + the joining-day and company link tokens
... trust-agent-run [HOUR]             → T5: one calling-agent pass at HOUR (default 11) IST tomorrow (any real hour)
... trust-t6-ready EMAIL [CLASSES] [CITY] → T6: Ready to join in Hyderabad (or CITY: a test's own place, so Hire now's
                                          top 10 holds only that test's people) with no notice and, with CLASSES
                                          ("MCWG,LMV"), a DigiLocker driving licence from the test provider (verified)
... trust-t8-high EMAIL|@demo-first   → T8: signals worth "High risk" (a test with the same answers as another
                                          account on a shared device, and the same PAN on another account), then
                                          that person is rated (a review opens)
... trust-t9-task EMAIL TEST [TYPE]  → T9: a "Skill verified" badge for TEST from an attempt with a practical
                                          task answer (TYPE tech / voice): the AI interview asks about it
... trust-t9-attempt EMAIL TEST DAYS   → T9: a finished skill check for TEST started DAYS days ago → {"id": attempt}
... trust-t10-badge EMAIL TEST        → T10: a "Skill verified" badge for TEST without a practical task answer (no
                                          explain question: the AI interview has its 7 questions)
... trust-t10-score EMAIL BAND [PRON]  → T10: a spoken-English score with that band (sub-scores around it; PRON "none":
                                          pronunciation not measured) from a voice interview today
... trust-t12-gaps TAG                 → T12: 45 skill checks in Pune (40 passed) and 45 in Ongole (9 passed) by new
                                          people: a pass-rate gap by city tier for the fairness report
... trust-t13-admin TAG                → T13: a real company "Tt13 TAG Slow Pvt Ltd" with 3 jobs posted 20 days ago,
                                          first contact 10 days later, and a live job posted 72 h ago nobody contacted
... trust-t13-job CID JOB              → T13: that job posted 3 hours ago, a Hire invite 45 minutes later (shortlist +
                                          contact) and an interview booked 2 h 15 m after posting
... trust-t12-regrade TAG              → T12: an AI interview whose "Explained own work" a second AI check disagreed
                                          with (strong → weak), waiting for a person → {"id": the re-grade}
... trust-t14-pass EMAIL TEST         → T14: a passed skill check for TEST (80/100) with its practical task not started
                                          yet → {"id": attempt} (a tech role becomes a coding task for Trust people)
... trust-t14-code WHO                 → T14: a finished coding task (5 of 5 hidden tests) with an editor replay (typing
                                          and one big paste) and the replay consent, for an email or @demo-applicants
... trust-t15-results EMAIL            → T15: work-test results (typing Hindi 38 wpm 96%, SJT strong 85, aptitude 87)
... trust-t15-record EMAIL CID JOB     → T15: the reliability consent (and the age check) + "Showed up 1/1 · Joined 1/1"
                                          and a no-show waiting 48 h for their side → {"token": the candidate's link}
... trust-t15-dispute EMAIL CID JOB    → T15: (consent +) a no-show the candidate disputed, for Admin → {"id": record}
... trust-t15-att EMAIL CID JOB BY     → T15: a booked interview 2 h ago (consent) → {"token": company's Attended link}
... trust-t15-stay EMAIL CID BY        → T15: an employer-confirmed join 31 days ago (consent) → {"token": stay link}
... trust-t7-person EMAIL KIND [consent] → T7: the adult age check, a resume (KIND data: SQL / Power BI; acct:
                                          Tally / GST, Telugu) and, with "consent", the job-requirements consent
... auto-apply-run [EMAIL [past]]      → the Auto Apply run now (any hour); with EMAIL and "past", that student's
                                          preview days are over first
... job-alerts EMAIL                   → {"sent": [{to, subject, text}], "stop": token} (the alert pass for one person,
                                          its emails captured instead of sent, and their "Stop these emails" token)
... aa2-email-run EMAIL                → A3: that tester's Auto Apply 2.0 run with the email channel on (in this
                                          process only), its emails captured instead of sent: {"sent": [...]}
... aa2-email-reply EMAIL FROM TEXT    → A3: a company's reply to that tester's apply address, as Resend's webhook
                                          would deliver it (the forward to the candidate captured)
... aa2-optout-token ADDRESS           → A3: the signed opt-out token a real (not test) Auto Apply email carries
... aa5-form-run EMAIL COMPANY_ID TAG  → A5: two jobs on that company's own (fake) site, one simple form and one with a
                                          CAPTCHA, then that tester's run and the form pass, every request answered
                                          by a fake site in this process (nothing leaves it): {"states": {...}}
... aa5-site SITE STATE REASON         → A5: a company site in Admin's form site list
... aa6-onetap-run EMAIL TAG           → A6: three jobs on a company's own site (found by the collector, so Ready
                                          for one tap while the switch is OFF), that tester's run and morning list,
                                          then the third job closes (shown as Closed): {"items": {title: id}}
... aa7-replies EMAIL TAG              → A7: that tester's 2.0 applications on every channel this week with replies:
                                          an email reply inviting to an interview, Nm7 "viewed" and "interview"
                                          moves, a hiring system's "shortlisted", and a waiting question
"""

import asyncio
import json
import os
import sys
from datetime import timedelta

from app.auth.admin_service import create_admin
from app.auth.models import User
from app.billing.checkout import new_org_order, quote, quote_out
from app.core.db import ORDERS, ORGANIZATIONS, PAYMENTS, USERS, close_client, ensure_indexes, get_client, get_database
from app.core.security import hash_password
from app.core.time import now
from app.orders.service import build_order, next_invoice_no
from app.payments.models import Payment


def t12_graded_interview(iid, uid: str, t) -> dict:
    """An AI-graded SQL interview shaped exactly like one the app stores (grade_and_store), with an "Explained own work"
    turn labelled strong: every list that reads interviews (Admin → Interviews → Graded, the candidate's page, the
    weekly checks) must be able to show it. Not passed, so it gives nobody the interview-ready level."""
    from app.hire.vetting.interview import BY_TEST, CRITERIA, SECONDS

    turns = [{"id": f"q{n}", "q": f"Question {n}", "answer": f"An answer about SQL ({n})."} for n in range(1, 7)]
    turns.append({"id": "explain1", "kind": "explain", "q": "Explain your own task", "quote": "JOIN orders o ON o.id",
                  "answer": "I joined the two tables on the id."})  # fmt: skip
    scores = [{"key": k, "score": 2, "reason": "Short answers."} for k, _label, _guide in CRITERIA]
    grade = {"scores": scores, "strengths": ["Knows joins"], "concern": "Short answers.", "model": "", "by": "ai"}
    return {"_id": iid, "user_id": uid, "test": "SQL", "slug": BY_TEST["SQL"]["slug"], "lang": "en", "mode": "text",
            "turns": turns, "at": len(turns), "awaiting": "answer", "status": "graded", "seconds": SECONDS["text"],
            "started_at": t - timedelta(minutes=20), "asked_at": t - timedelta(minutes=5), "answered_at": t,
            "graded_at": t, "grade": grade, "passed": False,
            "explain": {"label": "strong", "by": "ai", "reason": "r"}}  # fmt: skip


class _Capture:
    """A mailer that keeps the emails instead of sending them."""

    available = True

    def __init__(self):
        self.sent = []

    async def send(self, e):
        self.sent.append({"to": e.to, "subject": e.subject, "text": e.text, "from": e.from_addr,
                          "replyTo": e.reply_to, "attachments": [n for n, _, _ in e.attachments]})  # fmt: skip


async def _aa5_form_run(db, mail: str, cid: str, tag: str) -> dict:
    import httpx

    from app.autoapply import engine, v2engine
    from app.autoapply.forms import polite
    from app.autoapply.forms import service as forms
    from app.jobs import service
    from app.jobs.model import JobIn
    from app.site import get_site

    site = f"co{tag}.example"
    jobs = {}
    for title, host in ((f"Data Analyst {tag}", f"careers.{site}"), (f"Reporting Analyst {tag}", f"apply.{site}")):
        body = {"title": title, "company": {"name": f"Autoco {tag} Pvt Ltd", "website": site},
                "locations": ["Hyderabad"], "experience": "fresher", "skills": ["SQL", "Power BI"],
                "description": "Build weekly dashboards in SQL and Power BI for our stores. Freshers are welcome.",
                "applyMethod": "link", "applyUrl": f"https://{host}/jobs/1"}  # fmt: skip
        _, doc = await service.save(db, JobIn.model_validate(body), "admin")
        await db["jobs"].update_one({"_id": doc["_id"]}, {"$set": {"company_id": cid}})
        jobs[host] = doc["_id"]
    form = (
        '<html><head><title>Careers</title>{head}</head><body><form method="post" action="/apply" '
        'enctype="multipart/form-data"><input type="hidden" name="t" value="x1"><label for="n">Full name</label>'
        '<input id="n" name="name" required><label for="e">Email</label><input id="e" type="email" name="email" '
        'required><label for="p">Phone</label><input id="p" name="phone"><label for="c">Cover letter</label>'
        '<textarea id="c" name="cover"></textarea><label for="r">Resume</label><input id="r" type="file" '
        'name="resume" required><button type="submit">Apply</button></form></body></html>'
    )

    def answer(request: httpx.Request) -> httpx.Response:
        path, host = request.url.path, request.url.host
        if path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nDisallow: /admin\n")
        if path == "/jobs/1":
            cap = '<script src="https://www.google.com/recaptcha/api.js"></script>'
            head = cap if host.startswith("apply.") else ""
            return httpx.Response(200, text=form.replace("{head}", head), headers={"content-type": "text/html"})
        if path == "/apply" and request.method == "POST":
            return httpx.Response(303, headers={"location": "/thanks"})
        if path == "/thanks":
            return httpx.Response(200, text="<h1>Thank you!</h1><p>We have received your application.</p>")
        return httpx.Response(404, text="not found")

    polite.TRANSPORT = httpx.MockTransport(answer)  # this process only: nothing leaves it

    async def no_wait(_s):
        return None

    polite.SLEEP = no_wait
    u = await db[USERS].find_one({"email_lc": mail.lower()})
    counts = {"skipped_gate": 0}
    await v2engine.run_user(db, u, await get_site(db), engine.today(), counts)
    passes = await forms.run(db, limit=10)
    states = {}
    for host, jid in jobs.items():
        it = await db["auto_items"].find_one({"user_id": u["_id"], "job_id": jid}) or {}
        states[host] = {"state": it.get("state"), "reason": it.get("reason")}
    return {"states": states, "counts": counts, "pass": passes}


async def _aa6_onetap_run(db, mail: str, tag: str) -> dict:
    from app.autoapply import engine, onetap, v2engine
    from app.jobs import service
    from app.jobs.model import JobIn
    from app.site import get_site

    ids = {}
    for i, title in enumerate((f"Data Analyst {tag}", f"Reporting Analyst {tag}", f"BI Analyst {tag}")):
        body = {"title": title, "company": {"name": f"Onetap {tag} Pvt Ltd", "website": f"co{tag}.example"},
                "locations": ["Hyderabad"], "experience": "fresher", "skills": ["SQL", "Power BI"],
                "description": "Build weekly dashboards in SQL and Power BI for our stores. Freshers are welcome.",
                "applyMethod": "link", "applyUrl": f"https://careers.co{tag}.example/jobs/{i + 1}"}  # fmt: skip
        _, doc = await service.save(db, JobIn.model_validate(body), "admin")
        ids[title] = doc["_id"]
    u = await db[USERS].find_one({"email_lc": mail.lower()})
    site = await get_site(db)
    counts = {"skipped_gate": 0}
    await v2engine.run_user(db, u, site, engine.today(), counts)
    listed = await onetap.morning(db, u, site, engine.today())
    await db["jobs"].update_one({"_id": ids[f"BI Analyst {tag}"]}, {"$set": {"status": "closed"}})
    items = {}
    for title, jid in ids.items():
        it = await db["auto_items"].find_one({"user_id": u["_id"], "job_id": jid}) or {}
        items[title] = {"id": it.get("_id"), "state": it.get("state")}
    return {"items": items, "listed": listed, "counts": counts}


async def _aa7_replies(db, mail: str, tag: str) -> dict:
    from bson import ObjectId

    from app.autoapply import replies
    from app.jobs.apply import app_key

    u = await db[USERS].find_one({"email_lc": mail.lower()})
    uid, t = u["_id"], now()
    out = {}

    async def item(key, title, channel, status=None, notices=(), **more):
        iid, jid = str(ObjectId()), f"aa7-{tag}-{key}"
        doc = {"_id": iid, "user_id": uid, "job_id": jid, "company": f"{key.title()} {tag} Ltd", "title": title,
               "slug": jid, "state": "needs_answer" if status is None else "applied", "v2": True,
               "channel_v2": channel, "notices": list(notices), "created_at": t, "updated_at": t,
               **({"notice": notices[-1]} if notices else {}), **more}  # fmt: skip
        await db["auto_items"].insert_one(doc)
        if status:
            tl = [{"status": "applied", "at": t}] + ([{"status": status, "at": t}] if status != "applied" else [])
            await db["applications"].insert_one({
                "key": app_key(jid), "user_id": uid, "job_id": jid, "status": status, "origin": "auto", "v2": True,
                "date": int(t.timestamp() * 1000), "resume_id": "r1", "resume_name": "Main (Auto Apply)",
                "url": f"https://nm7.si/jobs/{jid}", "notes": "", "next": None,
                "channel": "email" if channel == "email" else "nm7",
                "channel_v2": channel, "auto_item_id": iid, "timeline": tl, "company": doc["company"], "role": title,
                "created_at": t, "updated_at": t,
            })  # fmt: skip
        out[key] = iid
        return doc

    def n(status, text, hours):
        return {"status": status, "text": text, "at": t - timedelta(hours=hours), "seen": False}

    await item(
        "viewer",
        f"Data Analyst {tag}",
        "internal",
        "viewed",
        [n("viewed", f"Viewer {tag} Ltd opened your application for Data Analyst {tag}.", 5)],
    )
    await item(
        "inviter",
        f"BI Analyst {tag}",
        "internal",
        "interview",
        [n("interview", f"Inviter {tag} Ltd invited you to an interview for BI Analyst {tag}.", 2)],
    )
    await item(
        "partner",
        f"Reporting Analyst {tag}",
        "partner",
        "shortlisted",
        [n("shortlisted", f"Partner {tag} Ltd shortlisted you for Reporting Analyst {tag}.", 3)],
        partner={"name": "Darwinbox", "state": "delivered"},
    )
    mail_it = await item(
        "mailer",
        f"MIS Executive {tag}",
        "email",
        "applied",
        replied_at=t - timedelta(hours=1),
        interview_at=t - timedelta(hours=1),
        interview_alert_at=t - timedelta(hours=1),
        replies=1,
    )
    text = (
        f"Hi Asha, thank you for applying for MIS Executive {tag}. We would like to invite you to an interview on "
        "Thursday at 11 AM. Please reply with a time that suits you."
    )
    subject = f"Re: Application for MIS Executive {tag}"
    await db["auto_replies"].insert_one({
        "_id": str(ObjectId()), "user_id": uid, "item_id": mail_it["_id"], "job_id": mail_it["job_id"],
        "company": mail_it["company"], "title": mail_it["title"], "from": f"hr@mailer-{tag}.example",
        "from_name": "Mailer HR", "subject": subject, "text": text, "received_at": t - timedelta(hours=1),
        "forwarded": True, "kind": replies.rules_kind(subject, text), "kind_by": "rules",
    })  # fmt: skip
    await item("asker", f"Data Executive {tag}", "internal")
    return {"items": out}


async def main(cmd: str, *args: str) -> dict:
    name = os.environ.get("MONGODB_DB", "")
    if not name.endswith("_e2e"):
        sys.exit("MONGODB_DB must end with _e2e")
    db = get_database()
    if cmd == "reset":
        await get_client().drop_database(name)
        await ensure_indexes(db)
        return {"ok": True}
    if cmd == "site-langs":  # Admin → Settings → "Show Telugu and Hindi" (item 41): on | off
        (state,) = args
        await db["settings"].update_one({"_id": "site"}, {"$set": {"languages.te_hi": state == "on"}}, upsert=True)
        return {"ok": True}
    if cmd == "site-autoapply":  # Admin → Auto Apply → the global switch: on | off
        (state,) = args
        await db["settings"].update_one({"_id": "site"}, {"$set": {"auto_apply.on": state == "on"}}, upsert=True)
        return {"ok": True}
    if cmd == "vetting-tester":  # Admin → Skill checks → Launch: this email sees the vetting engine while it is hidden
        (email,) = args
        await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"vetting.testers": email.lower()}}, upsert=True)
        return {"ok": True}
    if cmd == "trust-tester":  # Admin → Skill checks → Vetting Trust: this email sees Trust while it is hidden
        (email,) = args
        await db["settings"].update_one({"_id": "site"}, {"$addToSet": {"trust.testers": email.lower()}}, upsert=True)
        return {"ok": True}
    if cmd == "trust-agent-person":  # Vetting Trust T5: a phone, the age check and a resume (the consent is the UI's)
        from tests.jobs_helpers import RESUME

        mail, phone = args
        u = await db["users"].find_one({"email": mail})
        t = now()
        await db["users"].update_one({"_id": u["_id"]}, {"$set": {"phone": f"+91 {phone[:5]} {phone[5:]}"}})
        age = {"adult_from": t - timedelta(days=3650), "age_checked_at": t, "age_method": "dob"}
        await db["trust_profiles"].update_one({"_id": u["_id"]}, {"$set": age}, upsert=True)
        doc = {"name": "Main", "data": RESUME, "active": True, "created_at": t, "updated_at": t}
        await db["resumes"].update_one({"user_id": u["_id"], "key": "r1"}, {"$set": doc}, upsert=True)
        return {"id": u["_id"]}
    if cmd == "strong-resume":  # profile setup P2: a resume that passes every ATS check (score 100), as the active one
        from tests.jobs_helpers import strong_resume

        (mail,) = args
        u = await db["users"].find_one({"email": mail})
        t = now()
        doc = {"name": "Main", "data": strong_resume(), "active": True, "created_at": t, "updated_at": t}
        await db["resumes"].update_one({"user_id": u["_id"], "key": "r1"}, {"$set": doc}, upsert=True)
        return {"id": u["_id"]}
    if cmd == "setup-l3":  # profile setup P2: a passed AI interview (Vetting V3's L3), valid for 30 days
        (mail,) = args
        await db["users"].update_one({"email": mail}, {"$set": {"vetting_l3_until": now() + timedelta(days=30)}})
        return {"ok": True}
    if cmd == "trust-t6-ready":  # Vetting Trust T6: a Hire now candidate, with a verified (test) driving licence
        from bson import ObjectId

        mail = args[0]
        u = await db["users"].find_one({"email": mail})
        t = now()
        prof = {
            "on": True, "join_date": "", "cities": [args[2] if len(args) > 2 and args[2] else "Hyderabad"],
            "remote": False, "notice_days": 0,
            "salary": {"amount": 25000, "unit": "month"}, "job_types": ["full_time"], "returner": False,
            "hide_from": [], "confirmed_at": t, "consent_at": t, "paused_at": None, "updated_at": t, "created_at": t,
        }  # fmt: skip
        await db["hire_profiles"].update_one({"_id": u["_id"]}, {"$set": prof}, upsert=True)
        if len(args) > 1 and args[1]:
            await db["trust_documents"].delete_many({"user_id": u["_id"], "kind": "dl"})
            doc = {
                "_id": ObjectId(), "user_id": u["_id"], "kind": "dl", "doc_type": "DRVLC", "issuer": "Transport",
                "fields": {"classes": args[1].split(","), "valid_until": ""}, "vendor": "mock", "test": True,
                "fetched_at": t, "created_at": t, "verify_until": t + timedelta(days=300), "name_match": "match",
                "review": {"status": "none", "reasons": [], "note": "", "explained_at": None},
            }  # fmt: skip
            await db["trust_documents"].insert_one(doc)
        return {"id": u["_id"]}
    if cmd == "trust-t7-person":  # Vetting Trust T7: a resume of one kind, the age check and (optionally) the consent
        from tests.jobs_helpers import RESUME, resume

        mail, kind = args[0], args[1]
        u = await db["users"].find_one({"email": mail})
        t = now()
        age = {"adult_from": t - timedelta(days=3650), "age_checked_at": t, "age_method": "dob"}
        await db["trust_profiles"].update_one({"_id": u["_id"]}, {"$set": age}, upsert=True)
        data = RESUME
        if kind == "acct":
            data = resume(
                personal={"name": u.get("name", ""), "headline": "Accountant · Tally · GST", "location": "Hyderabad"},
                summary="Accountant who keeps the books for small shops.",
                exp=[{"company": "Sri Lakshmi Traders", "role": "Tally accountant", "from": "2025-03", "current": True,
                      "description": "Kept the books in Tally ERP 9 for 40 shops\nFiled monthly GST returns"}],
                skillGroups=[{"id": "core", "label": "Core", "value": "Tally, GST"}], proj=[], certs=[],
                langs=[{"name": "Telugu"}],
            )  # fmt: skip
        doc = {"name": "Main", "data": data, "active": True, "created_at": t, "updated_at": t}
        await db["resumes"].update_one({"user_id": u["_id"], "key": "r1"}, {"$set": doc}, upsert=True)
        if len(args) > 2 and args[2] == "consent":
            from app.trust import consent as C
            from app.trust.criteria import router as _  # noqa: F401 — registers the purpose

            await C.grant(db, u["_id"], "criteria_match", "flow")
        return {"id": u["_id"]}
    if cmd == "trust-agent-run":  # Vetting Trust T5: one pass at a daytime hour (the e2e may run at night in India)
        from datetime import datetime, time

        from app.core.time import IST
        from app.trust.agent import service as agent

        hour = int(args[0]) if args else 11
        at = datetime.combine((now().astimezone(IST) + timedelta(days=1)).date(), time(hour, 0), IST)
        return await agent.run(db, t=at, force=True)
    if cmd == "trust-withdraw-token":  # Vetting Trust T1: the signed withdraw link's token (as in an email)
        from app.trust.consent import withdraw_token

        mail, purpose = args
        u = await db["users"].find_one({"email": mail})
        return {"token": withdraw_token(u["_id"], purpose)}
    if cmd == "trust-docs":  # Vetting Trust T2: test-provider DigiLocker documents for an email or the demo applicants
        from app.companies.demo import COMPANY_ID
        from app.trust.digilocker import providers, service

        (who,) = args
        if who == "@demo-applicants":
            uids = await db["applications"].distinct("user_id", {"company_id": COMPANY_ID})
        else:
            uids = [(await db["users"].find_one({"email": who}))["_id"]]
        for uid in uids:
            u = await db["users"].find_one({"_id": uid}, {"name": 1})
            sess = {"_id": f"seed-{uid}", "user_id": uid, "kinds": list(service.KINDS),
                    "vendor_ref": f"mock-seed-{uid}", "mock_approved": True}  # fmt: skip
            got = await providers.Mock().fetch(sess, name_hint=(u or {}).get("name") or "")
            await service.store(db, uid, sess, got.docs, "mock", True)
        return {"n": len(uids)}
    if cmd == "trust-face":  # Vetting Trust T3: test-provider "ID + selfie verified" (email or @demo-applicants)
        from app.companies.demo import COMPANY_ID

        who, same = args
        if who == "@demo-applicants":
            uids = await db["applications"].distinct("user_id", {"company_id": COMPANY_ID})
        else:
            uids = [(await db["users"].find_one({"email": who}))["_id"]]
        t = now()
        for uid in uids:
            st = {
                "user_id": uid,
                "status": "verified",
                "verified_at": t,
                "verified_by": "check",
                "vendor": "mock",
                "test": True,
                "tries": 0,
                "process_at": t,
                "updated_at": t,
                "liveness": {"pass": True, "score": 97},
                "match": {"pass": True, "score": 96},
            }
            if same == "same":
                st["continuity"] = {"status": "same", "at": t, "tries": 0}
            await db["trust_face"].update_one({"_id": uid}, {"$set": st, "$setOnInsert": {"created_at": t}}, True)
        return {"n": len(uids)}
    if cmd == "trust-t8-high":  # Vetting Trust T8: signals worth "High risk" for an email or the first demo applicant
        from bson import ObjectId

        from app.companies.demo import COMPANY_ID
        from app.trust.integrity import service as T8

        (who,) = args
        if who == "@demo-first":
            uids = sorted(await db["applications"].distinct("user_id", {"company_id": COMPANY_ID}))[:1]
        else:
            uids = [(await db["users"].find_one({"email": who}))["_id"]]
        t = now()
        for uid in uids:
            integ = {"level": "retest", "points": 5, "reasons": ["pattern_match", "shared_device"]}
            att = {"_id": ObjectId(), "v": 2, "user_id": uid, "skill": "SQL", "started_at": t, "last_seen": t}
            await db["skill_attempts"].insert_one({**att, "submitted_at": t, "remaining_ms": 0, "integrity": integ})
            rv = {"status": "open", "reasons": ["pan_elsewhere"], "note": "", "explained_at": None}
            doc = {"_id": ObjectId(), "user_id": uid, "kind": "pan", "fields": {}, "vendor": "mock", "test": True}
            until = t + timedelta(days=300)
            doc |= {"fetched_at": t, "created_at": t, "verify_until": until, "name_match": "match", "review": rv}
            await db["trust_documents"].insert_one(doc)
            await T8.refresh(db, uid)
        return {"n": len(uids), "ids": uids}
    if cmd in ("trust-t10-badge", "trust-t10-score"):  # Vetting Trust T10: a badge to interview with / a measured score
        from bson import ObjectId

        from app.hire.vetting.roles import BY_TEST
        from app.trust.spoken.score import BANDS

        mail, what, *rest = args
        u = await db["users"].find_one({"email": mail})
        t = now()
        if cmd == "trust-t10-badge":
            rec = {"user_id": u["_id"], "test": what, "slug": BY_TEST[what]["slug"], "role": BY_TEST[what]["role"]}
            rec |= {"band": "1-3", "score": 82, "task_score": 80, "at": t, "expires_at": t + timedelta(days=90)}
            rec["attempt_id"] = ObjectId()
            await db["vetting_verified"].update_one({"user_id": u["_id"], "test": what}, {"$set": rec}, upsert=True)
            return {"ok": True}
        v = dict(BANDS)[what] + 5
        pron = None if rest and rest[0] == "none" else min(100, v + 10)
        subs = {"pronunciation": pron, "fluency": v, "grammar": v, "comprehension": v}
        row = {"_id": ObjectId(), "user_id": u["_id"], "test": "Customer support", "created_at": t, "at": t}
        row |= {"band": what, "overall": v, "subs": subs, "by": "ai", "provider": "mock", "answers": 7}
        row["fluency"] = {"score": v, "wpm": 120, "pausesPerMin": 1.0, "fillersPer100": 0.5, "minutes": 2.0}
        await db["trust_spoken"].insert_one(row)
        return {"ok": True}
    if cmd == "trust-t14-pass":  # Vetting Trust T14: a passed skill check whose practical task is still open
        from bson import ObjectId

        from app.hire.vetting.roles import BY_TEST

        mail, test = args
        u = await db["users"].find_one({"email": mail})
        aid, t = ObjectId(), now()
        await db["skill_attempts"].insert_one(
            {
                "_id": aid,
                "v": 2,
                "user_id": u["_id"],
                "skill": test,
                "slug": BY_TEST[test]["slug"],
                "kind": "full",
                "lang": "en",
                "integrity": {"level": "clean"},
                "remaining_ms": 0,
                "topics": {},
                "band": "fresher",
                "started_at": t - timedelta(minutes=12),
                "last_seen": t,
                "submitted_at": t,
                "score": 80,
                "right": 15,
                "total": 18,
            }
        )
        return {"id": str(aid)}
    if cmd == "trust-t15-results":  # Vetting Trust T15: work-test results that make badges in Hire now
        u = await db["users"].find_one({"email": args[0]})
        t = now()
        rows = [
            (
                "typing",
                "hi",
                {"wpm": 38, "accuracy": 96.0, "chars": 230, "errors": 2, "seconds": 72.0, "completed": True},
            ),
            ("sjt", "te", {"score": 85, "level": "strong", "points": 17, "of": 20, "answered": 10}),
            (
                "aptitude",
                "en",
                {
                    "score": 87,
                    "right": 13,
                    "of": 15,
                    "answered": 15,
                    "sections": {},
                    "top": "top30",
                    "provisional": True,
                },
            ),
        ]
        for test, lang, res in rows:
            await db["trust_worktests"].insert_one(
                {
                    "user_id": u["_id"],
                    "test": test,
                    "lang": lang,
                    "key": f"typing:{lang}" if test == "typing" else test,
                    "form": "e2e",
                    "status": "submitted",
                    "started_at": t,
                    "submitted_at": t,
                    "result": res,
                    "flags": [],
                    "integrity": {},
                }
            )
        return {"id": u["_id"]}
    if cmd in ("trust-t15-record", "trust-t15-dispute", "trust-t15-att", "trust-t15-stay"):  # Vetting Trust T15
        from bson import ObjectId

        from app.core.time import IST
        from app.trust import consent as TC
        from app.trust.booking import service as booking
        from app.trust.reliability import service as REL

        u = await db["users"].find_one({"email": args[0]})
        cid = args[1]
        t = now()
        await db["trust_profiles"].update_one(
            {"_id": u["_id"]},
            {"$set": {"adult_from": t - timedelta(days=3650), "age_checked_at": t, "age_method": "dob"}},
            upsert=True,
        )
        await TC.grant(db, u["_id"], REL.PURPOSE, "flow")
        if cmd == "trust-t15-record":
            job = args[2]
            await REL.put(
                db,
                "interview",
                f"e2e-{ObjectId()}",
                user_id=u["_id"],
                company_id=cid,
                job_id=job,
                outcome="yes",
                source="employer",
            )
            await REL.put(
                db,
                "join",
                f"e2e-{ObjectId()}",
                user_id=u["_id"],
                company_id=cid,
                job_id=job,
                outcome="yes",
                source="employer",
            )
            await REL.put(
                db,
                "interview",
                f"e2e-{ObjectId()}",
                user_id=u["_id"],
                company_id=cid,
                job_id=job,
                outcome="no",
                source="employer",
            )
            link = await booking.link_for(
                db,
                "rel_me",
                user_id=u["_id"],
                company_id=cid,
                offer_id="record",
                source="e2e",
                until=t + timedelta(days=14),
            )
            return {"token": booking.token_for(link)}
        if cmd == "trust-t15-dispute":
            ref = f"e2e-{ObjectId()}"
            await REL.put(
                db, "interview", ref, user_id=u["_id"], company_id=cid, job_id=args[2], outcome="no", source="employer"
            )
            await REL.answer(db, u["_id"], f"interview:{ref}", "company_cancelled")
            return {"id": f"interview:{ref}"}
        if cmd == "trust-t15-att":
            job, by = args[2], args[3]
            sid = ObjectId()
            st = t - timedelta(hours=2)
            await db["hire_slots"].insert_one(
                {
                    "_id": sid,
                    "company_id": cid,
                    "job_id": job,
                    "starts_at": st,
                    "minutes": 30,
                    "place": "Office",
                    "link": "",
                    "interviewer": "",
                    "round": "",
                    "status": "booked",
                    "user_id": u["_id"],
                    "seq": 1,
                    "by": by,
                    "created_at": st,
                    "updated_at": st,
                }
            )
            link = await booking.link_for(
                db,
                "attendance",
                user_id=u["_id"],
                company_id=cid,
                offer_id=str(sid),
                source="e2e",
                until=t + timedelta(days=14),
            )
            return {"token": booking.token_for(link)}
        oid = ObjectId()
        day = (t.astimezone(IST).date() - timedelta(days=31)).isoformat()
        await db["hire_offers"].insert_one(
            {
                "_id": oid,
                "user_id": u["_id"],
                "job_id": "t15-job",
                "company_id": cid,
                "company_name": "T15 Foods",
                "candidate_name": u.get("name", ""),
                "title": "Store associate",
                "salary": {"amount": 20000, "unit": "month"},
                "join_date": day,
                "place": "Hyderabad",
                "status": "joined",
                "joined": {"company": True, "candidate": True},
                "respond_by": t,
                "answered_at": t,
                "by": args[2],
                "created_at": t,
                "updated_at": t,
            }
        )
        await REL.put(
            db, "join", str(oid), user_id=u["_id"], company_id=cid, job_id="t15-job", outcome="yes", source="employer"
        )
        link = await booking.link_for(
            db, "stay", user_id=u["_id"], company_id=cid, offer_id=str(oid), source="e2e", until=t + timedelta(days=30)
        )
        return {"token": booking.token_for(link)}
    if cmd == "trust-t14-code":  # Vetting Trust T14: a finished coding task with its editor replay (and the consent)
        from bson import ObjectId

        from app.companies.demo import COMPANY_ID
        from app.trust.code import problems as PB
        from app.trust.code import replay as RP

        (who,) = args
        if who == "@demo-applicants":
            uids = await db["applications"].distinct("user_id", {"company_id": COMPANY_ID})
        else:
            uids = [(await db["users"].find_one({"email": who}))["_id"]]
        p = PB.SEEDS[0]
        start = p["languages"]["python"]
        typed = "\nprint(sum(x for x in nums if x % 2 == 0))\n"
        paste = "# helper pasted from my notes\n" + "def evens(xs):\n    return [x for x in xs if x % 2 == 0]\n" * 4
        events = [[120, "e", len(start) + i, 0, ch] for i, ch in enumerate(typed)] + [
            [4000, "b", 0, 0, ""],
            [9000, "f", 0, 0, ""],
        ]
        events.append([300, "p", len(start) + len(typed), 0, paste])
        rep = {"v": 1, "start": start, "lang": "python", "truncated": False, "events": events}
        source = RP.final_text(rep)
        t = now()
        for uid in uids:
            aid = ObjectId()
            cases = [
                {
                    "i": i,
                    "hidden": i >= 2,
                    "name": x["name"],
                    "status": "ran",
                    "passed": True,
                    "time_s": 0.02,
                    "memory_kb": 3000,
                }
                for i, x in enumerate([*p["samples"], *p["hidden"]])
            ]
            await db["trust_code"].insert_one(
                {
                    "_id": aid,
                    "user_id": uid,
                    "skill": "Python",
                    "problem": PB.snapshot({**p, "version": 1}),
                    "runs": 3,
                    "created_at": t,
                    "submission": {
                        "status": "done",
                        "language": "python",
                        "source": source,
                        "queued_at": t,
                        "done_at": t,
                        "tries": 0,
                        "passed": 5,
                        "total": 5,
                        "failing_samples": [],
                        "cases": cases,
                        "flags": ["code_big_paste"],
                        "counters": {"typed": len(typed), "pasted": len(paste), "largestPaste": len(paste)},
                        "replay": "kept",
                    },
                }
            )
            await db["trust_code_replays"].insert_one(
                {
                    "user_id": uid,
                    "attempt_id": aid,
                    "skill": "Python",
                    "language": "python",
                    "replay": rep,
                    "stats": {**RP.stats(rep), "consistent": True},
                    "size": RP.size_of(rep),
                    "created_at": t,
                }
            )
            await db["trust_consents"].update_one(
                {"user_id": uid, "purpose": "code_replay", "withdrawn_at": None},
                {"$setOnInsert": {"version": 1, "granted_at": t, "channel": "flow"}},
                upsert=True,
            )
        return {"n": len(uids)}
    if cmd == "vet-passed":  # Vetting fix batch: a passed V2 test (82/100, clean), its practical task not opened yet
        from bson import ObjectId

        from app.hire.vetting.roles import BY_TEST

        mail, test = args
        u = await db["users"].find_one({"email": mail})
        aid, t = ObjectId(), now() - timedelta(hours=1)
        await db["skill_attempts"].insert_one({
            "_id": aid, "v": 2, "user_id": u["_id"], "skill": test, "slug": BY_TEST[test]["slug"], "kind": "full",
            "lang": "en", "band": "fresher", "integrity": {"level": "clean"}, "remaining_ms": 0, "topics": {},
            "started_at": t - timedelta(minutes=12), "last_seen": t, "submitted_at": t, "score": 82, "right": 15,
            "total": 18, "share": False,
        })  # fmt: skip
        return {"id": str(aid)}
    if cmd in ("trust-t9-task", "trust-t9-attempt"):  # Vetting Trust T9: a task answer behind a badge / a past attempt
        from bson import ObjectId

        from app.hire.vetting.roles import BY_TEST

        mail, test, *rest = args
        u = await db["users"].find_one({"email": mail})
        aid = ObjectId()
        base = {"_id": aid, "v": 2, "user_id": u["_id"], "skill": test, "slug": BY_TEST[test]["slug"], "kind": "full"}
        base |= {"lang": "en", "integrity": {"level": "clean"}, "remaining_ms": 0, "topics": {}}
        if cmd == "trust-t9-attempt":
            t = now() - timedelta(days=int(rest[0]))
            when = {"started_at": t, "last_seen": t, "submitted_at": t}
            await db["skill_attempts"].insert_one(
                {**base, **when, "band": "fresher", "score": 44, "right": 8, "total": 18}
            )
            return {"id": str(aid)}
        kind = rest[0] if rest else "tech"
        answers = {
            "voice": "First I greet the customer and ask what they need. Then I show two phones in their budget and "
            "explain the battery and camera. If they are unsure I offer a demo and note their number for a call.",
            "tech": "SELECT c.city, SUM(o.amount) FROM orders o JOIN customers c ON c.id = o.customer_id GROUP BY "
            "c.city. I join on the key, filter the month and group by city so the owner sees sales per city. "
            "Before sharing I would check NULL cities and refunds.",
        }
        t = now()
        old = t - timedelta(days=40)
        task = {"status": "graded", "type": kind, "answer": answers[kind], "score": 80, "submitted_at": old}
        when = {"started_at": old, "last_seen": old, "submitted_at": old}
        await db["skill_attempts"].insert_one({**base, **when, "band": "1-3", "score": 82, "task": task})
        rec = {"user_id": u["_id"], "test": test, "slug": BY_TEST[test]["slug"], "role": BY_TEST[test]["role"]}
        rec |= {"band": "1-3", "score": 82, "task_score": 80, "at": t, "expires_at": t + timedelta(days=90)}
        await db["vetting_verified"].update_one(
            {"user_id": u["_id"], "test": test}, {"$set": {**rec, "attempt_id": aid}}, upsert=True
        )
        return {"id": str(aid)}
    if cmd == "trust-offer":  # Vetting Trust T3: an accepted offer joining in N days (the joining check)
        from bson import ObjectId

        from app.core.time import IST

        mail, days = args
        u = await db["users"].find_one({"email": mail})
        oid = ObjectId()
        day = (now().astimezone(IST).date() + timedelta(days=int(days))).isoformat()
        t = now()
        offer = {
            "_id": oid,
            "user_id": u["_id"],
            "job_id": "seed-job",
            "company_id": "seed-co",
            "company_name": "Seed Foods",
            "candidate_name": u.get("name", ""),
            "title": "Store analyst",
            "salary": {"amount": 25000, "unit": "month"},
            "join_date": day,
            "place": "Hyderabad",
            "notes": "",
            "status": "accepted",
            "respond_by": t + timedelta(days=3),
            "answered_at": t,
            "typed_name": u.get("name", ""),
            "agreed": True,
            "created_at": t,
            "updated_at": t,
        }
        await db["hire_offers"].insert_one(offer)
        return {"id": str(oid)}
    if cmd == "trust-t11-book":  # Vetting Trust T11: a shortlisted application and its one-tap booking link's token
        from app.jobs.apply import app_key
        from app.trust.booking import service as booking

        mail, cid, jid = args
        u = await db["users"].find_one({"email": mail})
        t = now()
        await db["applications"].update_one(
            {"user_id": u["_id"], "key": app_key(jid)},
            {"$set": {"job_id": jid, "company_id": cid, "status": "shortlisted", "company": "T11 Co", "role": "Analyst",
                      "channel": "nm7", "company_removed_at": None, "updated_at": t},
             "$setOnInsert": {"timeline": [{"status": "shortlisted", "at": t}], "created_at": t}},
            upsert=True,
        )  # fmt: skip
        link = await booking.link_for(db, "interview", user_id=u["_id"], company_id=cid, job_id=jid, source="e2e",
                                      until=t + timedelta(days=14))  # fmt: skip
        return {"token": booking.token_for(link)}
    if cmd == "trust-t11-offer":  # Vetting Trust T11: an accepted offer joining in N days + the joining-day link tokens
        from bson import ObjectId

        from app.core.time import IST
        from app.trust.booking import service as booking

        mail, cid, days, by = args[0], args[1], int(args[2]), args[3]
        lang = args[4] if len(args) > 4 else ""
        u = await db["users"].find_one({"email": mail})
        t = now()
        oid = ObjectId()
        day = (now().astimezone(IST).date() + timedelta(days=days)).isoformat()
        await db["hire_offers"].insert_one({
            "_id": oid, "user_id": u["_id"], "job_id": "t11-job", "company_id": cid, "company_name": "T11 Foods",
            "candidate_name": u.get("name", ""), "title": "Store analyst", "salary": {"amount": 25000, "unit": "month"},
            "join_date": day, "place": "Hitech City, Gate 2", "notes": "", "status": "accepted",
            "respond_by": t + timedelta(days=3), "answered_at": t, "typed_name": u.get("name", ""), "agreed": True,
            "by": by, "created_at": t, "updated_at": t,
            "t11_join": {"time": "10:00", "place": "Hitech City, Gate 2", "map": "https://maps.example.com/t11"},
        })  # fmt: skip
        if lang:
            await db["trust_agent_prefs"].update_one({"_id": u["_id"]}, {"$set": {"lang": lang}}, upsert=True)
        until = t + timedelta(days=days + 5)
        kw = {"user_id": u["_id"], "company_id": cid, "offer_id": str(oid), "source": "e2e", "until": until}
        j = await booking.link_for(db, "join", **kw)
        c = await booking.link_for(db, "company_join", **kw)
        return {"id": str(oid), "join": booking.token_for(j), "company": booking.token_for(c)}
    if cmd == "trust-t12-gaps":  # Vetting Trust T12: a city-tier pass-rate gap (new people each time)
        (tag,) = args
        t = now() - timedelta(days=1)
        for city, passed in (("Pune", 40), ("Ongole", 9)):
            for i in range(45):
                uid = f"t12-{tag}-{city}-{i}"
                mail = f"{uid}@example.com"
                await db["users"].insert_one(
                    {"_id": uid, "name": f"T12 {i}", "email": mail, "email_lc": mail, "created_at": t}
                )
                await db["hire_profiles"].insert_one({"_id": uid, "cities": [city], "on": False})
                row = {"v": 2, "user_id": uid, "skill": "SQL", "kind": "full", "lang": "en", "started_at": t}
                row |= {"submitted_at": t, "score": 85 if i < passed else 30}
                await db["skill_attempts"].insert_one(row)
        return {"ok": True}
    if cmd == "trust-t13-admin":  # Vetting Trust T13: a slow real company for the Daily report's "Time to hire"
        from bson import ObjectId

        (tag,) = args
        t = now()
        cid = f"tt13-{tag}"
        name = f"Tt13 {tag} Slow Pvt Ltd"
        await db["companies"].insert_one(
            {"_id": cid, "slug": cid, "details": {"legal_name": name}, "members": [], "created_at": t}
        )
        for i in range(4):
            jid = f"{cid}-j{i}"
            p = t - (timedelta(hours=72) if i == 3 else timedelta(days=20))
            await db["jobs"].insert_one(
                {
                    "_id": jid,
                    "dedupe_key": f"k-{jid}",
                    "slug": jid,
                    "title": f"Tt13 cook {i}",
                    "status": "active",
                    "source": "company",
                    "company_id": cid,
                    "posted_at": p,
                    "created_at": p,
                    "updated_at": p,
                }
            )
            if i < 3:
                await db["hire_invites"].insert_one(
                    {
                        "_id": ObjectId(),
                        "company_id": cid,
                        "job_id": jid,
                        "user_id": f"u-{jid}",
                        "status": "sent",
                        "created_at": p + timedelta(days=10),
                    }
                )
        return {"id": cid}
    if cmd == "trust-t13-job":  # Vetting Trust T13: a company job with a shortlist, a contact and an interview
        from bson import ObjectId

        cid, jid = args
        p = now() - timedelta(hours=3)
        await db["jobs"].update_one({"_id": jid}, {"$set": {"posted_at": p, "created_at": p}})
        await db["hire_invites"].insert_one(
            {
                "_id": ObjectId(),
                "company_id": cid,
                "job_id": jid,
                "user_id": f"u-t13-{jid}",
                "status": "sent",
                "created_at": p + timedelta(minutes=45),
            }
        )
        await db["trust_hire_events"].update_one(
            {"_id": f"{jid}:interview"},
            {
                "$set": {
                    "job_id": jid,
                    "company_id": cid,
                    "kind": "interview",
                    "at": p + timedelta(minutes=135),
                    "via": "e2e",
                }
            },
            upsert=True,
        )
        return {"ok": True}
    if cmd == "trust-t12-regrade":  # Vetting Trust T12: a T9 label the second AI check disagreed with
        from bson import ObjectId

        (tag,) = args
        t = now()
        uid = f"t12-rg-{tag}"
        mail = f"{uid}@example.com"
        await db["users"].insert_one(
            {"_id": uid, "name": "T12 Regrade", "email": mail, "email_lc": mail, "created_at": t}
        )
        iid = ObjectId()
        await db["vetting_interviews"].insert_one(t12_graded_interview(iid, uid, t))
        rid = ObjectId()
        rg = {"_id": rid, "kind": "t9", "ref": str(iid), "user_id": uid, "key": "SQL", "first": "strong"}
        rg |= {"second": "weak", "gap": 2, "material": True, "status": "review", "at": t}
        await db["trust_regrades"].insert_one(rg)
        return {"id": str(rid)}
    if cmd == "aa2-tester":  # Admin → Auto Apply 2.0: this email sees 2.0 while it is hidden
        (email,) = args
        await db["settings"].update_one(
            {"_id": "site"}, {"$addToSet": {"auto_apply_v2.testers": email.lower()}}, upsert=True
        )
        return {"ok": True}
    if cmd == "hire-token":  # the one-tap "Still ready" link's token from the reminder email (Phase 5 H1)
        from app.hire.available import still_token

        (mail,) = args
        u = await db["users"].find_one({"email": mail})
        return {"token": still_token(u["_id"])}
    if cmd == "skill-pass":  # Phase 6 S2: an official skill check finished with this score (the badge needs it)
        from app.seek.paths import on_skill_check

        mail, skill, score = args
        u = await db["users"].find_one({"email": mail})
        t = now()
        doc = {"user_id": u["_id"], "skill": skill, "started_at": t, "ends_at": t, "submitted_at": t,
               "score": int(score), "late": False, "total": 10}  # fmt: skip
        await db["skill_attempts"].insert_one(doc)
        await on_skill_check(db, u["_id"], skill)
        return {"ok": True}
    if cmd == "skill-verified":  # Vetting V2: a "Skill verified" badge; "@demo" = the first 3 Hire-in-60 demo people
        from app.hire.demo import DOMAIN
        from app.hire.vetting.roles import BY_TEST

        who, test, band, score, task = args
        q = {"email": {"$regex": rf"@{DOMAIN.replace('.', r'\.')}$"}} if who == "@demo" else {"email": who}
        users = await db["users"].find(q).to_list(3 if who == "@demo" else 1)
        t = now()
        for i, u in enumerate(users):
            sc = int(score) - 4 * i
            rec = {"user_id": u["_id"], "test": test, "slug": BY_TEST[test]["slug"], "role": BY_TEST[test]["role"],
                   "band": band, "score": sc, "task_score": int(task), "at": t,
                   "expires_at": t + timedelta(days=90)}  # fmt: skip
            await db["vetting_verified"].update_one({"user_id": u["_id"], "test": test}, {"$set": rec}, upsert=True)
            await db["users"].update_one({"_id": u["_id"]}, {"$push": {"verified_skills": {
                "skill": test, "role": rec["slug"], "at": t, "band": band, "score": sc, "task": int(task),
                "expires_at": rec["expires_at"], "source": "v2"}}})  # fmt: skip
        return {"n": len(users)}
    if cmd == "skill-answers":  # Vetting V2: the right shown option per question of an attempt (screenshots only)
        from bson import ObjectId

        (aid,) = args
        a = await db["skill_attempts"].find_one({"_id": ObjectId(aid)})
        qs = await db["skill_questions"].find({"_id": {"$in": a["question_ids"]}}).to_list(50)
        return {"answers": {str(q["_id"]): a["order"][str(q["_id"])].index(q["answer"]) for q in qs}}
    if cmd == "company-verify":
        (cid,) = args
        await db["companies"].update_one(
            {"_id": cid},
            {"$set": {"review.state": "approved", "verified_until": now() + timedelta(days=365), "trust": "verified"}},
        )
        return {"ok": True}
    if cmd == "share-count":  # Share button taps today, per channel (the counter has no personal data)
        from app.core.time import ist_day

        return {r["channel"]: r["n"] async for r in db["share_events"].find({"day": ist_day()})}
    if cmd == "job":
        from app.jobs import service
        from app.jobs.model import JobIn

        body, *rest = args
        _, doc = await service.save(db, JobIn.model_validate(json.loads(body)), "admin")
        sets = {}
        if rest and rest[0]:
            sets["status"] = rest[0]
        if len(rest) > 1:
            sets["posted_at"] = now() - timedelta(hours=float(rest[1]))
        if sets:
            await db["jobs"].update_one({"_id": doc["_id"]}, {"$set": sets})
        return {"id": doc["_id"], "slug": doc["slug"]}
    if cmd == "collector-job":  # round J: a job the morning collector posted (source "collector", summary written)
        from app.jobs import service
        from app.jobs.model import JobIn

        body, *waiting = args  # round M: a second argument "no_page_text,…" makes it wait for review for those
        _, doc = await service.save(db, JobIn.model_validate(json.loads(body)), "collector")
        key = doc["apply"]["url"].split("://", 1)[-1].lower().rstrip("/")
        meta = {"url_key": key, "summarised": not waiting, "removed": False}
        sets = {"collector": meta}
        if waiting:
            sets.update(status="review", review={"reasons": waiting[0].split(","), "note": ""})
        await db["jobs"].update_one({"_id": doc["_id"]}, {"$set": sets})
        return {"id": doc["_id"], "slug": doc["slug"]}
    if cmd == "auto-apply-run":
        from app.autoapply import engine

        if len(args) >= 2 and args[1] == "past":
            await db[USERS].update_one(
                {"email_lc": args[0].lower()}, {"$set": {"auto_apply.started_at": now() - timedelta(days=10)}}
            )
        await db[USERS].update_many({}, {"$set": {"auto_apply.run_day": None}})
        out = await engine.run(db, force=True, limit=1000)
        return {k: v for k, v in out.items() if isinstance(v, (int, bool))}
    if cmd == "job-alerts":
        from app.jobs import alerts

        (mail,) = args
        u = await db[USERS].find_one({"email_lc": mail.lower()})

        class Capture:
            def __init__(self):
                self.sent = []

            async def send(self, e):
                self.sent.append({"to": e.to, "subject": e.subject, "text": e.text})

        cap = Capture()
        await alerts.send_alerts(db, cap)
        return {"sent": [x for x in cap.sent if x["to"] == u["email"]], "stop": alerts.unsub_token(u["_id"])}
    if cmd in ("aa2-email-run", "aa2-email-reply"):
        from app.autoapply import emailing, engine, inbound, v2engine
        from app.core.config import get_settings
        from app.site import get_site

        s = get_settings()  # the channel on in this process only; every email goes to the capture below, none is sent
        s.resend_api_key, s.resend_inbound_secret = "re_e2e_capture_only", "whsec_ZTJlLWNhcHR1cmU="
        u = await db[USERS].find_one({"email_lc": args[0].lower()})
        cap = _Capture()
        if cmd == "aa2-email-run":
            counts = {"skipped_gate": 0}
            await v2engine.run_user(db, u, await get_site(db), engine.today(), counts, cap)
            return {"sent": cap.sent, "counts": counts}
        alias = await emailing.apply_address(db, u)
        got = await inbound.on_reply(
            db, {"from": args[1], "to": [alias], "subject": "Re: your application", "text": args[2]}, cap
        )
        return {**got, "sent": cap.sent, "alias": alias}
    if cmd == "aa5-form-run":
        return await _aa5_form_run(db, *args)
    if cmd == "aa6-onetap-run":
        return await _aa6_onetap_run(db, *args)
    if cmd == "aa7-replies":
        return await _aa7_replies(db, *args)
    if cmd == "aa5-site":
        from app.autoapply.forms import service as forms

        key, state, reason = args
        await forms._seen(db, key, state=state, reason=reason, last_tried=now())
        return {"ok": True}
    if cmd == "aa2-optout-token":
        from app.autoapply import emailing

        return {"token": emailing.optout_token(args[0])}
    if cmd == "admin":
        email, role, password = args
        _, secret, _ = await create_admin(db, email, role.title(), role, password)
        return {"secret": secret}
    if cmd in ("customer", "expert"):
        email, full_name, password, *rest = args
        status = rest[0] if rest else None
        u = User(
            email=email,
            name=full_name,
            role=cmd,
            expert_status=status,
            password_hash=await hash_password(password),
            email_verified_at=now(),
            terms_accepted_at=now(),
        )
        await db[USERS].insert_one(u.to_mongo())
        if status:
            await db["expert_profiles"].insert_one({"_id": u.id, "status": status, "profile": {}, "note": ""})
        return {"id": u.id}
    if cmd == "paid-order":
        email, plan = args
        user = User.load(await db[USERS].find_one({"email_lc": email.lower()}))
        order = await build_order(db, user, plan, "Data Analyst", [])
        t = now()
        order.status, order.paid_at = ("done" if plan == "diy" else "offer"), t
        order.invoice_no = await next_invoice_no(db, t)
        order.deadline_at = None if plan == "diy" else t + timedelta(hours=48)
        await db[ORDERS].insert_one(order.to_mongo())
        pay = Payment(
            order_id=order.id,
            razorpay_order_id=f"order_{order.id}",
            razorpay_payment_id=f"pay_{order.id.replace('-', '')}",
            amount=order.amount,
            currency="INR",
            status="captured",
            method="upi",
            captured_at=t,
        )
        await db[PAYMENTS].insert_one(pay.to_mongo())
        return {"id": order.id}
    if cmd == "customer-order":
        email, plan = args
        user = User.load(await db[USERS].find_one({"email_lc": email.lower()}))
        order = await build_order(db, user, plan, None, [])
        await db[ORDERS].insert_one(order.to_mongo())
        rzp_order = f"order_E2E{order.id.replace('-', '')}"
        pay = Payment(order_id=order.id, razorpay_order_id=rzp_order, amount=order.amount, status="created")
        await db[PAYMENTS].insert_one(pay.to_mongo())
        return {
            "orderId": order.id,
            "razorpayOrderId": rzp_order,
            "amount": order.amount,
            "currency": "INR",
            "keyId": "rzp_test_e2e",
            "name": "Nm7",
            "description": f"{order.items[0].name} · {order.id}",
            "prefill": {"name": user.name, "email": user.email},
        }
    if cmd == "org-order":
        org_id, plan, email, *ref = args
        user = User.load(await db[USERS].find_one({"email_lc": email.lower()}))
        o = await db[ORGANIZATIONS].find_one({"_id": org_id})
        q = await quote(db, o, plan)
        extra = {"ref_code": ref[0], "ref_via": "link"} if ref else {}  # the partner code the page showed
        order = await new_org_order(db, o, user.id, q, **extra)
        await db[ORDERS].insert_one(order.to_mongo())
        rzp_order = f"order_E2E{order.id.replace('-', '')}"
        pay = Payment(order_id=order.id, razorpay_order_id=rzp_order, amount=order.amount, status="created")
        await db[PAYMENTS].insert_one(pay.to_mongo())
        return {
            "orderId": order.id,
            "razorpayOrderId": rzp_order,
            "amount": order.amount,
            "currency": "INR",
            "keyId": "rzp_test_e2e",
            "name": "Nm7",
            "description": f"{q['terms']['plan_name']} plan",
            "prefill": {"name": user.name, "email": user.email},
            "quote": quote_out(q),
        }
    sys.exit(f"unknown command {cmd}")


if __name__ == "__main__":

    async def run():
        try:
            print(json.dumps(await main(*sys.argv[1:])))
        finally:
            await close_client()

    asyncio.run(run())
