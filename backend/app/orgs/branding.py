"""Branded templates (Nm7 for Organizations, Phase 3B): an organization's logo, colour, header line, optional footer
line and one ATS-safe base template. A group with "Print with organization template" on prints every org-side copy
(view, PDF, print, combined PDF, ZIP, kiosk print, recruiter links) in that template: the member's content (hidden
entries stay hidden) in the base template, with the logo and colour in the header only. The member's own resume and
downloads never change.

Official placement template (colleges, Phase 2): the same branding also holds the college's placement format: the
college name, a header style (logo left + name, or logo centred), the footer (page numbers are added), 1-3 allowed
base templates out of all 19 (one on Drive; a member's own template is used when it is allowed, else the first), and
on Campus (`template_rules`) the section order (required sections first), required sections (and CGPA), allowed
optional sections, a page limit, photo yes / no and roll number shown / hidden. Only the layout changes: the content,
and which sections the member switched on or off, never do. Unmet rules are shown to the member as a checklist.

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
ALL_TEMPLATES = (
    "fresher", "campus", "starter", "work", "kio", "classic", "formal", "modern", "stack", "mono", "compact", "impact",
    "executive", "accent", "twocol", "sidebar", "care", "academic", "portrait",
)  # fmt: skip
AnyTemplate = Literal[
    "fresher", "campus", "starter", "work", "kio", "classic", "formal", "modern", "stack", "mono", "compact", "impact",
    "executive", "accent", "twocol", "sidebar", "care", "academic", "portrait",
]  # fmt: skip
SECTIONS = ("summary", "exp", "proj", "edu", "skills", "certs", "ach", "langs", "hobbies", "strengths", "pinfo", "decl")
Section = Literal["summary", "exp", "proj", "edu", "skills", "certs", "ach", "langs", "hobbies", "strengths", "pinfo",
                  "decl"]  # fmt: skip
COLOR = r"^#[0-9A-Fa-f]{6}$"
EDIT_RULES = [(60, timedelta(hours=1))]


class RulesIn(CamelModel):
    """Campus: the college's rules for the placement format (layout only; content is never changed)."""

    order: list[Section] = Field(default_factory=list, max_length=12)  # sections in this order first, then the rest
    required: list[Section] = Field(default_factory=list, max_length=12)  # must have content (checklist)
    require_cgpa: bool = False  # education must show a CGPA / percentage (checklist)
    optional: list[Section] | None = Field(None, max_length=12)  # other sections allowed; None = any
    max_pages: Literal[1, 2] | None = None
    photo: bool = False  # a photo may print
    show_roll: bool = False  # the roll number prints in the header strip


class BrandingIn(CamelModel):
    color: str = Field("#1F3A8A", pattern=COLOR)
    header: str = Field("", max_length=90)  # the placement cell line, e.g. "Training & Placement Cell"
    footer: str = Field("", max_length=120)
    template: Template = "fresher"
    # placement template (None: keep what is stored)
    college_name: str | None = Field(None, max_length=90)
    header_style: Literal["left", "center"] | None = None
    templates: list[AnyTemplate] | None = Field(None, min_length=1, max_length=3)
    rules: RulesIn | None = None
    clear_rules: bool = False


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
def _templates(b: dict[str, Any], rules_on: bool) -> list[str]:
    ts = [t for t in b.get("templates") or [] if t in ALL_TEMPLATES]
    if not ts:
        ts = [b["template"] if b.get("template") in ALL_TEMPLATES else "fresher"]
    return ts[: 3 if rules_on else 1]


def rules_out(r: dict[str, Any] | None) -> dict[str, Any] | None:
    if not r:
        return None
    return {
        "order": [x for x in r.get("order") or [] if x in SECTIONS],
        "required": [x for x in r.get("required") or [] if x in SECTIONS],
        "requireCgpa": bool(r.get("require_cgpa")),
        "optional": None if r.get("optional") is None else [x for x in r["optional"] if x in SECTIONS],
        "maxPages": r.get("max_pages"),
        "photo": bool(r.get("photo")),
        "showRoll": bool(r.get("show_roll")),
    }


def brand_out(o: dict[str, Any]) -> dict[str, Any]:
    b = o.get("branding") or {}
    logo = b.get("logo")
    rules_on = features_of(o)["template_rules"]
    templates = _templates(b, rules_on)
    return {
        "color": b.get("color") or "#1F3A8A",
        "header": b.get("header") or "",
        "footer": b.get("footer") or "",
        "template": templates[0],
        "templates": templates,
        "collegeName": b.get("college_name") or "",
        "headerStyle": b.get("header_style") or "left",
        "rules": rules_out(b.get("rules")) if rules_on else None,
        "rulesAllowed": rules_on,
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
    rules_on = features_of(o)["template_rules"]
    if (body.rules is not None or (body.templates and len(body.templates) > 1)) and not rules_on:
        raise ApiError(
            402,
            "plan_feature",
            "More than one template, section order and college rules are in the Campus plan. "
            "Ask your Owner to upgrade (Organization → Billing).",
        )
    sets: dict[str, Any] = {
        "branding.color": body.color.upper(),
        "branding.header": " ".join(body.header.split()),
        "branding.footer": " ".join(body.footer.split()),
        "branding.template": body.template,
        "branding.updated_at": now(),
    }
    if body.college_name is not None:
        sets["branding.college_name"] = " ".join(body.college_name.split())
    if body.header_style is not None:
        sets["branding.header_style"] = body.header_style
    if body.templates is not None:
        sets["branding.templates"] = list(dict.fromkeys(body.templates))
        sets["branding.template"] = body.templates[0] if body.templates[0] in BASE_TEMPLATES else body.template
    if body.rules is not None:
        r = body.rules.model_dump()
        r["order"] = list(dict.fromkeys(r["order"]))
        r["required"] = list(dict.fromkeys(r["required"]))
        sets["branding.rules"] = r
    elif body.clear_rules:
        sets["branding.rules"] = None
    await db[ORGANIZATIONS].update_one({"_id": o["_id"]}, {"$set": sets})
    what = {"color": sets["branding.color"], "template": body.template}
    if body.templates is not None:
        what["templates"] = sets["branding.templates"]
    if "branding.rules" in sets:
        what["rules"] = "set" if sets["branding.rules"] else "cleared"
    return await _changed(db, scope, request, o["_id"], **what)


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
