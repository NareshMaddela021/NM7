"""WhatsApp / SMS reminders (no paid gateway): wa.me and sms: links carry only the message and the first name;
only students with a mobile who allow reminders; sent progress; phone-list CSV; only {name} in a message; gateway
stub disabled; organization isolation."""

from urllib.parse import parse_qs, urlparse

import pytest

from app.college import reminders
from app.core.db import AUDIT_LOG, MEMBERSHIPS, USERS
from tests.test_college_drives import campus, students
from tests.test_orgs_phase2 import coordinator, second_org


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


def test_links_carry_only_the_message_and_first_name():
    msg = "Hi {name}, please finish your resume for Friday's drive."
    link = reminders.wa_link("919876543210", reminders.text_for(msg, "Asha Rao"))
    u = urlparse(link)
    assert (u.scheme, u.netloc, u.path) == ("https", "wa.me", "/919876543210")
    assert parse_qs(u.query) == {"text": ["Hi Asha, please finish your resume for Friday's drive."]}
    s = reminders.sms_link("919876543210", "Hi Asha")
    assert s == "sms:+919876543210?body=Hi%20Asha"
    assert reminders.digits("+91 98765 43210") == "919876543210" and reminders.digits("12345") is None
    assert reminders.GATEWAY.available is False


async def test_batch_skips_no_phone_and_opted_out_progress_and_csv(owner, make_client, outbox, db):
    org, g = await campus(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    people = await students(make_client, outbox, 4)
    mids = [m for _, m in people]
    uids = {m["_id"]: m["user_id"] async for m in db[MEMBERSHIPS].find({"_id": {"$in": mids}})}
    for i, mid in enumerate(mids[:3]):
        await db[USERS].update_one({"_id": uids[mid]}, {"$set": {"phone": f"+91 98765 4321{i}"}})
    await db[MEMBERSHIPS].update_one({"_id": mids[2]}, {"$set": {"reminders_opt_out": True}})
    base = f"/api/org/{org['id']}/wa-reminders"
    assert (await c.get(f"{base}/gateway")).json() == {"connected": False}
    # only {name}
    r = await c.post(base, json={"membershipIds": mids, "message": "Hi {name}, your roll {roll}"})
    assert r.status_code == 422
    r = await c.post(
        base, json={"membershipIds": mids, "message": "Hi {name}, add your projects today.", "list": "noProjects"}
    )
    assert r.status_code == 201, r.text
    b = r.json()
    assert (b["total"], b["sent"], b["skipped"]) == (2, 0, {"noPhone": 1, "optedOut": 1, "notFound": 0})
    for it in b["items"]:
        q = parse_qs(urlparse(it["whatsapp"]).query)["text"][0]
        assert q.startswith("Hi Student,") and "21A0" not in it["whatsapp"] and "@" not in it["whatsapp"]
        assert it["sms"].startswith("sms:+91987654321")
    # progress
    r = await c.post(f"{base}/{b['id']}/sent", json={"membershipId": b["items"][0]["membershipId"]})
    assert (r.json()["sent"], r.json()["total"]) == (1, 2)
    assert (
        await c.post(f"{base}/{b['id']}/sent", json={"membershipId": mids[3]})
    ).status_code == 404  # not in the batch
    csv = (await c.get(f"{base}/{b['id']}/phones.csv")).text
    assert csv.splitlines()[0] == "Name,Mobile" and "+91987654321" in csv
    acts = {a["action"] async for a in db[AUDIT_LOG].find({"data.orgs": org["id"]})}
    assert {"wa_batch", "wa_sent", "wa_phones_csv"} <= acts
    # nobody with a phone
    r = await c.post(base, json={"membershipIds": [mids[3]], "message": "Hi {name}, hello."})
    assert r.status_code == 400 and r.json()["error"]["code"] == "no_phones"
    # viewers can't make batches; another organization sees nothing
    viewer, _ = await coordinator(owner, make_client, outbox, org["id"], email="viewer@example.com", role="viewer")
    assert (await viewer.post(base, json={"membershipIds": mids, "message": "Hi {name}, hello."})).status_code == 403
    o2, _ = await second_org(owner)
    await owner.put(f"/api/admin/orgs/{o2['id']}/billing/plan", json={"planId": "campus"})
    other, _ = await coordinator(owner, make_client, outbox, o2["id"], email="other@example.com")
    assert (await other.get(f"/api/org/{o2['id']}/wa-reminders/{b['id']}")).status_code == 404
    r = await other.post(
        f"/api/org/{o2['id']}/wa-reminders", json={"membershipIds": mids, "message": "Hi {name}, hello."}
    )
    assert r.status_code == 400  # none of them are theirs: no one to message


async def test_off_on_free(owner, make_client, outbox):
    from tests.test_orgs import setup_group

    org, _ = await setup_group(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    assert (await c.get(f"/api/org/{org['id']}/wa-reminders/gateway")).status_code == 404
