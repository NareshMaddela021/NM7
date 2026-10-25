"""Nm7 for Organizations (Phase 3B): branded templates — the feature switch, logo checks (PNG / JPG / SVG cleaning,
300 KB), who may change branding, the group's "Print with organization template" setting, and that org-side views
and exports carry the brand while the member's own resume never changes."""

import base64
import struct
import zlib

import pytest

from app.core.db import AUDIT_LOG, ORGANIZATIONS, RESUMES
from app.core.errors import ApiError
from app.orgs.branding import sanitize_svg
from tests.test_orgs import join, member, setup_group
from tests.test_orgs_kiosk import features, make_kiosk
from tests.test_orgs_phase2 import coordinator, second_org


def err(r):
    return r.json()["error"]["code"]


def png(w=2, h=2) -> bytes:
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def data_url(mime: str, raw: bytes) -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


BRAND = {"color": "#1f3a8a", "header": "JNTU Anantapur  ·  Placement Cell", "footer": "placements@jntua.ac.in"}


@pytest.fixture
async def owner(admin_client):
    return await admin_client("owner")


@pytest.fixture
async def setup(owner):
    org, g = await setup_group(owner)
    await features(owner, org["id"], branding=True)
    return org, g


async def test_branding_is_404_when_switched_off_and_never_crosses_organizations(owner, make_client, outbox):
    org, g = await setup_group(owner)
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    base = f"/api/org/{org['id']}/branding"
    assert (await c.get(base)).status_code == 404
    assert (await c.put(base, json=BRAND)).status_code == 404
    assert (await c.put(f"{base}/logo", json={"data": data_url("image/png", png())})).status_code == 404
    r = await c.patch(f"/api/org/{org['id']}/groups/{g['id']}", json={"settings": {"printBranded": True}})
    assert r.status_code == 404  # the group setting needs the feature too
    await features(owner, org["id"], branding=True)
    assert (await c.put(base, json=BRAND)).status_code == 200
    org_b, _ = await second_org(owner)
    await features(owner, org_b["id"], branding=True)
    assert (await c.get(f"/api/org/{org_b['id']}/branding")).status_code == 404
    assert (await c.put(f"/api/org/{org_b['id']}/branding", json=BRAND)).status_code == 404


async def test_coordinators_set_branding_viewers_only_read_it(setup, owner, db, make_client, outbox):
    org, _ = setup
    base = f"/api/org/{org['id']}/branding"
    c, _ = await coordinator(owner, make_client, outbox, org["id"])
    v, _ = await coordinator(owner, make_client, outbox, org["id"], "viewer@example.com", role="viewer")
    r = await c.put(base, json={**BRAND, "template": "classic"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b == {
        "color": "#1F3A8A",
        "header": "JNTU Anantapur · Placement Cell",
        "footer": "placements@jntua.ac.in",
        "template": "classic",
        "templates": ["classic"],
        "collegeName": "",
        "headerStyle": "left",
        "rules": None,
        "rulesAllowed": False,
        "logo": None,
        "updatedAt": b["updatedAt"],
    }
    assert (await v.get(base)).json()["header"] == "JNTU Anantapur · Placement Cell"
    assert (await v.put(base, json=BRAND)).status_code == 403
    assert (await v.put(f"{base}/logo", json={"data": data_url("image/png", png())})).status_code == 403
    # only the ATS-safe single-column templates, and real colours
    assert (await c.put(base, json={**BRAND, "template": "twocol"})).status_code == 422
    assert (await c.put(base, json={**BRAND, "color": "red"})).status_code == 422
    # the owner can set it too (through the portal API)
    assert (await owner.put(base, json={**BRAND, "template": "work"})).json()["template"] == "work"
    entries = [e async for e in db[AUDIT_LOG].find({"action": "branding_update"})]
    assert len(entries) == 2 and entries[0]["data"]["by"] == "staff"


async def test_logo_upload_validation(setup, owner, db):
    org, _ = setup
    url = f"/api/org/{org['id']}/branding/logo"
    r = await owner.put(url, json={"data": data_url("image/png", png(120, 40))})
    assert r.status_code == 200 and r.json()["logo"].startswith("data:image/png;base64,")
    jpg = b"\xff\xd8\xff\xe0" + b"\x00" * 64 + b"\xff\xd9"
    assert (
        (await owner.put(url, json={"data": data_url("image/jpeg", jpg)})).json()["logo"].startswith("data:image/jpeg;")
    )
    for bad in (
        data_url("image/png", b"GIF89a....."),  # not what it says
        data_url("image/gif", png()),  # not an allowed type
        "https://example.com/logo.png",
        data_url("image/png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 8),  # broken PNG
    ):
        r = await owner.put(url, json={"data": bad})
        assert r.status_code == 400 and err(r) == "bad_logo", bad[:40]
    big = png() + b"\x00" * (300 * 1024)
    r = await owner.put(url, json={"data": data_url("image/png", big)})
    assert r.status_code in (413, 422)
    assert (await owner.delete(url)).json()["logo"] is None
    assert (await db[ORGANIZATIONS].find_one({"_id": org["id"]}))["branding"]["logo"] is None


def test_svg_logos_are_cleaned():
    dirty = b"""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"
        onload="alert(1)">
      <script>alert(2)</script>
      <foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example"/></foreignObject>
      <rect width="10" height="10" fill="#123456" onclick="steal()" style="fill:url(https://evil.example/x)"/>
      <use xlink:href="https://evil.example/sprite.svg#a"/><use href="#ok"/>
      <a href="javascript:alert(3)"><circle r="2"/></a>
      <image href="data:image/png;base64,AAAA"/>
      <path d="M0 0L10 10" stroke="#000"/>
    </svg>"""
    out = sanitize_svg(dirty).decode()
    for gone in (
        "script",
        "alert",
        "onload",
        "onclick",
        "foreignObject",
        "iframe",
        "evil.example",
        "javascript",
        "image",
    ):
        assert gone not in out, gone
    assert 'fill="#123456"' in out and 'd="M0 0L10 10"' in out and 'href="#ok"' in out
    for bad in (
        b'<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
        b"<html/>",
        b"<svg",
    ):
        with pytest.raises(ApiError):
            sanitize_svg(bad)


async def test_svg_upload_is_stored_clean(setup, owner):
    org, _ = setup
    svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><script>x()</script><rect width="4"/></svg>'
    r = await owner.put(f"/api/org/{org['id']}/branding/logo", json={"data": data_url("image/svg+xml", svg)})
    assert r.status_code == 200
    stored = base64.b64decode(r.json()["logo"].split(",", 1)[1]).decode()
    assert "<rect" in stored and "script" not in stored


async def test_branded_group_exports_carry_the_brand_member_resume_unchanged(setup, owner, db, make_client, outbox):
    org, g = setup
    await owner.put(f"/api/org/{org['id']}/branding", json={**BRAND, "template": "classic"})
    await owner.put(f"/api/org/{org['id']}/branding/logo", json={"data": data_url("image/png", png())})
    c, _ = await member(make_client, outbox)
    assert (await join(c)).status_code == 201
    before = (await db[RESUMES].find_one({}))["data"]

    # setting off: no brand anywhere
    start = await owner.post("/api/admin/shared-resumes/exports", json={"kind": "print_bulk"})
    assert start.json()["brands"] == {} and start.json()["items"][0]["brand"] is None
    mid = start.json()["items"][0]["membershipId"]
    assert (await owner.get(f"/api/admin/shared-resumes/{mid}")).json()["brand"] is None

    r = await owner.patch(f"/api/admin/groups/{g['id']}", json={"settings": {"printBranded": True}})
    assert r.json()["settings"]["printBranded"] is True
    start = (await owner.post("/api/admin/shared-resumes/exports", json={"kind": "print_bulk"})).json()
    assert start["items"][0]["brand"] == g["id"]
    brand = start["brands"][g["id"]]
    assert brand["template"] == "classic" and brand["header"] == "JNTU Anantapur · Placement Cell"
    assert brand["logo"].startswith("data:image/png;base64,")
    view = (await owner.get(f"/api/org/{org['id']}/shared-resumes/{mid}")).json()
    assert view["brand"]["color"] == "#1F3A8A"
    data = (await owner.get(f"/api/admin/shared-resumes/exports/{start['job']}/data")).json()[0]["data"]
    assert [e["company"] for e in data["exp"]] == ["Infosys"]  # hidden entries stay hidden
    # kiosk print uses it too (when kiosks are on)
    await features(owner, org["id"], kiosk=True)
    _, token = await make_kiosk(owner, org["id"], g["id"])
    assert (await make_client().get(f"/api/kiosk/{token}")).json()["brand"]["template"] == "classic"

    # the member's own resume and their own view are untouched
    assert (await db[RESUMES].find_one({}))["data"] == before
    mine = (await c.get("/api/me/state")).json()["resumes"][0]
    assert "brand" not in mine and mine["data"] == before

    # switching the feature off stops branding at once (the group setting stays, but does nothing)
    await features(owner, org["id"], branding=False)
    start = (await owner.post("/api/admin/shared-resumes/exports", json={"kind": "print_bulk"})).json()
    assert start["brands"] == {}
