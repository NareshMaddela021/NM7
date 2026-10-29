"""Compare candidates (R2, Campus): 2–4 students side by side with CGPA, branch, year, skills, the job match score
with must-haves found / missing, projects, internships, certificates and ATS; contact details follow the invite's
rules (hidden / after shortlist); students outside the invite can't be compared; the Drive plan says Campus; logged."""

from app.core.db import AUDIT_LOG
from tests.test_org_recruiter_portal import JD, campus, err, invite, owner, plan, resume, sign_in  # noqa: F401
from tests.test_orgs_recruiter import opted_in

EXP = {"exp": [{"company": "Data Co", "role": "Analyst intern", "from": "2025-05", "to": "2025-07",
                "description": "Built reports"}],
       "proj": [{"title": "Sales dashboard", "tech": "Python, Power BI",
                 "description": "Cut reporting time by 30%. Used by 40 people.", "links": []}]}  # fmt: skip


async def people(make_client, outbox):
    await opted_in(make_client, outbox, "asha@example.com", "Asha Rao",
                   data=resume("Asha Rao", "asha@example.com", "Python, SQL, Power BI", "8.6 CGPA", **EXP))  # fmt: skip
    await opted_in(make_client, outbox, "bala@example.com", "Bala M",
                   data=resume("Bala M", "bala@example.com", "Java", "7.1 CGPA"), roll="2")  # fmt: skip
    await opted_in(make_client, outbox, "chitra@example.com", "Chitra S",
                   data=resume("Chitra S", "chitra@example.com", "Excel", "9.0 CGPA"), roll="3")  # fmt: skip


async def test_compare_side_by_side_with_match_and_contact_rules(campus, owner, db, make_client, outbox):  # noqa: F811
    org, g = campus
    await people(make_client, outbox)
    _, token = await invite(owner, org["id"], [g["id"]], contact="after_shortlist")
    rec = make_client()
    h = await sign_in(rec, outbox, token)
    base = f"/api/recruiter/{token}"
    page = (await rec.get(f"{base}/candidates", headers=h)).json()
    assert page["compare"] is True
    ids = {c["name"]: c["id"] for c in page["candidates"]}
    r = await rec.post(f"{base}/compare", headers=h, json={"ids": [ids["Asha Rao"], ids["Bala M"]], "jd": JD})
    assert r.status_code == 200, r.text
    a, b = r.json()["candidates"]
    assert r.json()["must"] and a["name"] == "Asha Rao" and b["name"] == "Bala M"  # in the order picked
    assert a["cgpa"] == 8.6 and a["branch"] == "CSE" and a["year"] == 2026 and isinstance(a["ats"], int)
    assert "Python" in a["skills"] and a["match"] > b["match"]
    assert "Python" in a["mustFound"] and "Python" in b["mustMissing"]
    proj = {"title": "Sales dashboard", "tech": "Python, Power BI", "line": "Cut reporting time by 30%."}
    assert a["projects"][0] == proj
    assert a["internships"][0]["company"] == "Data Co" and a["internships"][0]["when"] == "2025-05 – 2025-07"
    assert a["walletCertificates"] == []  # nothing shared from the certificate wallet
    # contact: hidden until shortlisted, then only for that student
    assert "email" not in a and "phone" not in a
    await rec.put(f"{base}/board/{ids['Asha Rao']}", headers=h, json={"stage": "shortlisted"})
    a, b = (await rec.post(f"{base}/compare", headers=h, json={"ids": [ids["Asha Rao"], ids["Bala M"]]})).json()[
        "candidates"
    ]
    assert a["email"] == "asha@example.com" and "email" not in b
    assert a["match"] is None  # no job post: no score
    # four at most, two at least, only this invite's students
    four = list(ids.values()) + [ids["Asha Rao"]]
    assert (await rec.post(f"{base}/compare", headers=h, json={"ids": four * 2})).status_code == 422
    assert (await rec.post(f"{base}/compare", headers=h, json={"ids": [ids["Asha Rao"]]})).status_code == 422
    dup = await rec.post(f"{base}/compare", headers=h, json={"ids": [ids["Asha Rao"], ids["Asha Rao"]]})
    assert err(dup) == "pick_two"
    assert (await rec.post(f"{base}/compare", headers=h, json={"ids": [ids["Asha Rao"], "x" * 20]})).status_code == 404
    # logged with who was compared
    logs = [a async for a in db[AUDIT_LOG].find({"action": "recruiter_compare"})]
    assert len(logs) == 2 and logs[0]["data"]["students"] == [ids["Asha Rao"], ids["Bala M"]]


async def test_hidden_contact_never_shows_and_drive_plan_says_campus(campus, owner, db, make_client, outbox):  # noqa: F811
    org, g = campus
    await people(make_client, outbox)
    _, token = await invite(owner, org["id"], [g["id"]], contact="hidden")
    rec = make_client()
    h = await sign_in(rec, outbox, token)
    base = f"/api/recruiter/{token}"
    ids = [c["id"] for c in (await rec.get(f"{base}/candidates", headers=h)).json()["candidates"]]
    for cid in ids:
        await rec.put(f"{base}/board/{cid}", headers=h, json={"stage": "shortlisted"})
    items = (await rec.post(f"{base}/compare", headers=h, json={"ids": ids})).json()["candidates"]
    assert len(items) == 3 and all("email" not in c and "phone" not in c for c in items)
    # Drive: no compare
    await plan(owner, org["id"], "drive")
    r = await rec.post(f"{base}/compare", headers=h, json={"ids": ids[:2]})
    assert r.status_code == 402 and err(r) == "plan_feature"
    assert (await rec.get(f"{base}/candidates", headers=h)).json()["compare"] is False
