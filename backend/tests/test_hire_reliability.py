"""Phase 5 H4: reliability from real events only. New people show "New - no history yet" with no score (never ranked
lower); quick replies, slow replies, unanswered invites, interviews and offers count as the rules say; saying Not
interested is fine; the candidate sees the score and tips; companies see the label and plain lines, never who marked a
no-show; deleting the account removes the events."""

from datetime import timedelta

from app.core.db import HIRE_EVENTS, HIRE_INVITES, USERS
from app.core.time import now
from app.hire import reliability as rel
from tests.test_companies_posting import no_ai, verified  # noqa: F401
from tests.test_companies_signup import H, no_network  # noqa: F401
from tests.test_hire_shortlist import post_job, ready


def test_score_rules():
    new = rel.score([])
    assert new["label"] == "New - no history yet" and new["score"] is None and new["tips"]
    assert rel.score(["reply_fast", "attended", "joined"])["score"] == 100
    s = rel.score(["reply_fast", "reply_fast", "no_reply"])  # 2 good, 1 bad
    assert s["score"] == 67 and s["label"] == "Reliable"
    assert s["lines"] == ["Replied to 2 of 3 invites within 24 hours"] and "unanswered" in s["tips"][0]
    s = rel.score(["attended", "no_show"])  # 2 for, 3 against
    assert s["score"] == 40 and s["label"] == "Mixed record" and s["lines"] == ["Came to 1 of 2 interviews"]
    assert rel.score(["reply_slow"])["score"] == 100  # late is still a reply
    assert rel.score(["joined", "dropped"])["lines"] == ["Joined 1 of 2 accepted offers"]


def test_invite_kinds():
    t = now()
    rows = [
        {"created_at": t - timedelta(hours=30), "answered_at": t - timedelta(hours=29), "status": "declined"},
        {"created_at": t - timedelta(days=3), "answered_at": t - timedelta(days=1), "status": "accepted"},
        {"created_at": t - timedelta(days=8), "status": "sent"},
        {"created_at": t - timedelta(days=1), "status": "sent"},  # still open: not counted yet
    ]
    assert rel.invite_kinds(rows, 24, t) == ["reply_fast", "reply_slow", "no_reply"]


async def test_mine_company_view_and_erase(client, outbox, db, make_client):
    from app.me.erase import erase_user_data

    session, cid = await verified(client, outbox, db)
    job = await post_job(client, session, cid)
    asha = await ready(make_client, outbox, "asha@example.com", "Asha Rao")
    me = (await asha.get("/api/me/hire/reliability")).json()
    assert me["label"] == "New - no history yet" and me["score"] is None
    url = f"/api/company/{cid}/hire/shortlist"
    row = (await client.get(url, params={"job": job}, headers=H(session))).json()["items"][0]
    assert row["reliability"]["label"] == "New - no history yet"
    uid = (await db[USERS].find_one({"email": "asha@example.com"}))["_id"]
    # a quick "Not interested" (fine) and an interview no-show marked by another company
    key = row["key"]
    await client.post(f"/api/company/{cid}/hire/invite", json={"job": job, "people": [key]}, headers=H(session))
    inv = (await asha.get("/api/me/hire/invites")).json()[0]
    await asha.post(f"/api/me/hire/invites/{inv['id']}", json={"answer": "decline", "reason": "place"})
    await rel.record(db, uid, "attended", "other-co", "iv1")
    await rel.record(db, uid, "no_show", "other-co", "iv2")
    await rel.record(db, uid, "no_show", "other-co", "iv2")  # marked twice: one event
    me = (await asha.get("/api/me/hire/reliability")).json()
    assert me["lines"] == ["Replied to 1 of 1 invites within 24 hours", "Came to 1 of 2 interviews"]
    assert me["score"] == 50 and any("Reschedule" in x for x in me["tips"])
    await db[HIRE_INVITES].delete_many({})  # so the next shortlist shows Asha again
    row = (await client.get(url, params={"job": job}, headers=H(session))).json()["items"][0]
    assert row["reliability"]["score"] == 40 and "other-co" not in str(row) and "tips" not in row["reliability"]
    await rel.forget(db, uid, "no_show", "iv2")  # the company corrected it
    assert (await asha.get("/api/me/hire/reliability")).json()["score"] == 100
    out = await erase_user_data(db, uid)
    assert out["hire_events"] == 1 and not await db[HIRE_EVENTS].find_one({"user_id": uid})
