"""Branded templates (Nm7 for Organizations, Phase 3B): an organization's logo, colour, header line, optional footer
line and one ATS-safe base template. A group with "Print with organization template" on prints every org-side copy
(view, PDF, print, combined PDF, ZIP, kiosk print, recruiter links) in that template: the member's content (hidden
entries stay hidden) in the base template, with the logo and colour in the header only. The member's own resume and
downloads never change.

Staff:  GET /api/org/{org_id}/branding (everyone on the team), PUT …/branding (coordinators and Nm7),
        PUT …/branding/logo, DELETE …/branding/logo. Needs the organization's `branding` feature (else 404).

Logos: PNG, JPG or SVG up to 300 KB, kept in the organization's document (like resumes, in MongoDB — no new storage
service). PNG / JPG are checked by their signature and size; SVGs are cleaned to a short list of drawing elements
and attributes (no scripts, event handlers, outside links, embedded HTML or entity tricks).
"""

import base64
import binascii
import re
import struct
import xml.etree.ElementTree as ET
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import Field

from app.audit import audit
from app.auth.sessions import client_ip
from app.core import rate_limit
from app.core.db import DB, ORG_GROUPS, ORGANIZATIONS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now
from app.orgs.scope import OrgScope, features_of, require_feature

router = APIRouter(prefix="/api/org/{org_id}/branding", tags=["branding"])

MAX_LOGO = 300 * 1024
BASE_TEMPLATES = ("fresher", "campus", "starter", "work", "classic", "formal", "care")  # single-column, ATS-safe
Template = Literal["fresher", "campus", "starter", "work", "classic", "formal", "care"]
COLOR = r"^#[0-9A-Fa-f]{6}$"
EDIT_RULES = [(60, timedelta(hours=1))]


class BrandingIn(CamelModel):
    color: str = Field("#1F3A8A", pattern=COLOR)
    header: str = Field("", max_length=90)
    footer: str = Field("", max_length=120)
    template: Template = "fresher"


class LogoIn(CamelModel):
    data: str = Field(max_length=MAX_LOGO * 2)  # a data URL: data:image/png;base64,…


# ---------- logo checks ----------
SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
SVG_TAGS = {
    "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs",
    "lineargradient", "radialgradient", "stop", "clippath", "title", "desc", "use", "symbol",
}  # fmt: skip
SVG_ATTRS = {
    "viewbox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points",
    "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
    "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "opacity", "transform", "id", "class",
    "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform", "clip-path", "clip-rule",
    "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "letter-spacing",
    "preserveaspectratio", "version", "style", "href", "fx", "fy", "spreadmethod", "clippathunits",
}  # fmt: skip
BAD_VALUE = re.compile(r"javascript:|data:|expression\s*\(|@import|url\s*\(\s*['\"]?(?!#)", re.I)
BAD_LOGO = ApiError(400, "bad_logo", "That logo couldn’t be read. Use a PNG, JPG or SVG file up to 300 KB.")


def _local(name: str) -> str:
    return name.rsplit("}", 1)[-1].lower()


def sanitize_svg(raw: bytes) -> bytes:
    """Keeps only drawing elements and attributes. Raises BAD_LOGO for anything that isn't a plain SVG."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise BAD_LOGO from None
    if re.search(r"<!DOCTYPE|<!ENTITY|<\?xml-stylesheet", text, re.I):
        raise BAD_LOGO  # no DTDs or entities: nothing can expand or point outside
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        raise BAD_LOGO from None
    if _local(root.tag) != "svg":
        raise BAD_LOGO

    def clean(el: ET.Element) -> None:
        for child in list(el):
            if not isinstance(child.tag, str) or _local(child.tag) not in SVG_TAGS:
                el.remove(child)  # script, foreignObject, image, style, a, animate, set, iframe… and comments
                continue
            clean(child)
        for k in list(el.attrib):
            name, v = _local(k), el.attrib[k]
            outside = name == "href" and not v.startswith("#")  # <use> may only point inside the logo
            if name not in SVG_ATTRS or name.startswith("on") or outside or BAD_VALUE.search(v):
                del el.attrib[k]

    clean(root)
    ET.register_namespace("", SVG_NS)
    ET.register_namespace("xlink", XLINK_NS)
    return ET.tostring(root, encoding="utf-8")


def _png_size(b: bytes) -> tuple[int, int] | None:
    if len(b) >= 24 and b[:8] == b"\x89PNG\r\n\x1a\n" and b[12:16] == b"IHDR":
        return struct.unpack(">II", b[16:24])
    return None


def _jpeg_ok(b: bytes) -> bool:
    return len(b) > 4 and b[:3] == b"\xff\xd8\xff" and b.rstrip(b"\x00")[-2:] == b"\xff\xd9"


def check_logo(data_url: str) -> tuple[str, bytes]:
    """(mime, bytes) of an uploaded logo, or 400 / 413."""
    m = re.match(r"^data:(image/(?:png|jpeg|jpg|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$", data_url.strip())
    if not m:
        raise BAD_LOGO
    try:
        raw = base64.b64decode(m.group(2), validate=False)
    except (binascii.Error, ValueError):
        raise BAD_LOGO from None
    if len(raw) > MAX_LOGO:
        raise ApiError(413, "logo_too_large", "The logo is over 300 KB. Please use a smaller file.")
    if _png_size(raw):
        w, h = _png_size(raw)
        if not (0 < w <= 4000 and 0 < h <= 4000):
            raise BAD_LOGO
        return "image/png", raw
    if _jpeg_ok(raw):
        return "image/jpeg", raw
    if raw.lstrip()[:1] == b"<":
        return "image/svg+xml", sanitize_svg(raw)
    raise BAD_LOGO


# ---------- what exports use ----------
def brand_out(o: dict[str, Any]) -> dict[str, Any]:
    b = o.get("branding") or {}
    logo = b.get("logo")
    return {
        "color": b.get("color") or "#1F3A8A",
        "header": b.get("header") or "",
        "footer": b.get("footer") or "",
        "template": b.get("template") if b.get("template") in BASE_TEMPLATES else "fresher",
        "logo": f"data:{logo['mime']};base64,{logo['data']}" if logo else None,
        "updatedAt": int(b["updated_at"].timestamp() * 1000) if b.get("updated_at") else None,
    }


async def brands_for(db, group_ids: list[str]) -> dict[str, dict[str, Any]]:
    """{group id: brand} for the groups that print in their organization's template (feature on, setting on)."""
    groups = (
        await db[ORG_GROUPS]
        .find({"_id": {"$in": list(set(group_ids))}, "settings.print_branded": True}, {"org_id": 1})
        .to_list(None)
    )
    if not groups:
        return {}
    orgs = {o["_id"]: o async for o in db[ORGANIZATIONS].find({"_id": {"$in": list({g["org_id"] for g in groups})}})}
    out = {}
    for g in groups:
        o = orgs.get(g["org_id"])
        if o and features_of(o)["branding"]:
            out[g["_id"]] = brand_out(o)
    return out


# ---------- staff ----------
async def _org(db, scope) -> dict[str, Any]:
    o = await db[ORGANIZATIONS].find_one({"_id": scope.org_id})
    require_feature(o, "branding")
    return o


async def _changed(db, scope, request: Request, o_id: str, **what: Any) -> dict[str, Any]:
    await audit(
        db, scope.actor_id, "branding_update", target=o_id, data=scope.audit_data(**what), ip=client_ip(request)
    )
    return brand_out(await db[ORGANIZATIONS].find_one({"_id": o_id}))


async def _limit(db, scope) -> None:
    key = f"branding:{scope.actor_id}"
    await rate_limit.check(db, key, EDIT_RULES)
    await rate_limit.record(db, key)


@router.get("")
async def get_branding(db: DB, scope: OrgScope) -> dict[str, Any]:
    return brand_out(await _org(db, scope))


@router.put("")
async def set_branding(body: BrandingIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    o = await _org(db, scope)
    scope.require("manage")
    await _limit(db, scope)
    sets = {
        "branding.color": body.color.upper(),
        "branding.header": " ".join(body.header.split()),
        "branding.footer": " ".join(body.footer.split()),
        "branding.template": body.template,
        "branding.updated_at": now(),
    }
    await db[ORGANIZATIONS].update_one({"_id": o["_id"]}, {"$set": sets})
    return await _changed(db, scope, request, o["_id"], color=sets["branding.color"], template=body.template)


@router.put("/logo")
async def set_logo(body: LogoIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    o = await _org(db, scope)
    scope.require("manage")
    await _limit(db, scope)
    mime, raw = check_logo(body.data)
    logo = {"mime": mime, "data": base64.b64encode(raw).decode(), "size": len(raw)}
    await db[ORGANIZATIONS].update_one(
        {"_id": o["_id"]}, {"$set": {"branding.logo": logo, "branding.updated_at": now()}}
    )
    return await _changed(db, scope, request, o["_id"], logo=mime.split("/")[1].split("+")[0], size=len(raw))


@router.delete("/logo")
async def remove_logo(request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    o = await _org(db, scope)
    scope.require("manage")
    await db[ORGANIZATIONS].update_one(
        {"_id": o["_id"]}, {"$set": {"branding.logo": None, "branding.updated_at": now()}}
    )
    return await _changed(db, scope, request, o["_id"], logo="removed")
