"""Certificate wallet API (Profile → Certificates).

  GET    /api/me/certificates                 the list (no file bytes), "Share certificates" on/off, limits, space used
  POST   /api/me/certificates                 {title, issuer, date, link, name, mime, data (base64)}
  PATCH  /api/me/certificates/{id}            {title?, issuer?, date?, link?, share?}
  DELETE /api/me/certificates/{id}
  GET    /api/me/certificates/{id}/file       the file (owner only)
  PUT    /api/me/certificates/sharing         {on}: "Share certificates" (default off)

Shared copies (organization staff, invited recruiters) are served by orgs/shared.py and orgs/recruiter_portal.py
through certs.service.shared_with_others / shared_file — only with sharing on and only the ticked certificates.
"""

from typing import Any

from fastapi import APIRouter, Response
from pydantic import Field, field_validator

from app.auth.deps import CustomerAuth
from app.auth.models import new_id
from app.certs import service as S
from app.core.db import CERTIFICATES, DB, USERS
from app.core.errors import ApiError
from app.core.schemas import CamelModel
from app.core.time import now

router = APIRouter(prefix="/api/me/certificates", tags=["certificates"])
NOT_FOUND = ApiError(404, "not_found", "Certificate not found.")


def _link(v: str) -> str:
    v = (v or "").strip()
    if v and not v.lower().startswith(("https://", "http://")):
        v = f"https://{v}"
    if v and (" " in v or "." not in v):
        raise ValueError("Use the full web address of the credential.")
    return v


class CertIn(CamelModel):
    title: str = Field(min_length=2, max_length=160)
    issuer: str = Field("", max_length=120)
    date: str = Field("", pattern=r"^(\d{4}(-\d{2}(-\d{2})?)?)?$")
    link: str = Field("", max_length=400)
    name: str = Field("", max_length=160)
    mime: str = Field(max_length=40)
    data: str = Field(min_length=8, max_length=3_000_000)  # base64 of at most 2 MB

    _v_link = field_validator("link")(classmethod(lambda cls, v: _link(v)))


class CertPatch(CamelModel):
    title: str | None = Field(None, min_length=2, max_length=160)
    issuer: str | None = Field(None, max_length=120)
    date: str | None = Field(None, pattern=r"^(\d{4}(-\d{2}(-\d{2})?)?)?$")
    link: str | None = Field(None, max_length=400)
    share: bool | None = None

    _v_link = field_validator("link")(classmethod(lambda cls, v: None if v is None else _link(v)))


class SharingIn(CamelModel):
    on: bool


@router.get("")
async def list_certs(auth: CustomerAuth, db: DB) -> dict[str, Any]:
    rows = await db[S.CERTIFICATES].find({"user_id": auth.user.id}, S.LIST_FIELDS).sort("created_at", 1).to_list(50)
    return {
        "items": [S.out(c) for c in rows],
        "share": await S.sharing_on(db, auth.user.id),
        "limits": {"files": S.MAX_FILES, "bytes": S.MAX_BYTES},
        "used": sum(c["size"] for c in rows),
    }


@router.post("", status_code=201)
async def add_cert(body: CertIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    uid = auth.user.id
    if await db[CERTIFICATES].count_documents({"user_id": uid}) >= S.MAX_FILES:
        raise ApiError(409, "too_many", f"You can keep up to {S.MAX_FILES} certificates. Delete one to add another.")
    raw = S.decode_file(body.data, body.mime)
    title = S.clean_text(body.title, 160)
    issuer = S.clean_text(body.issuer, 120)
    S.clean_text(body.name, 160)  # a file named "aadhaar.pdf" is refused too
    if await S.total_mb(db) + len(raw) / (1024 * 1024) > S.TOTAL_CAP_MB:
        raise S.FULL
    doc = {
        "_id": new_id(),
        "user_id": uid,
        "title": title,
        "issuer": issuer,
        "date": body.date,
        "link": body.link,
        "name": body.name.strip()[:160],
        "mime": body.mime,
        "size": len(raw),
        "file": S.as_binary(raw),
        "share": False,
        "created_at": now(),
    }
    await db[CERTIFICATES].insert_one(doc)
    return S.out(doc)


@router.patch("/{cert_id}")
async def edit_cert(cert_id: str, body: CertPatch, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    sets: dict[str, Any] = {}
    if body.title is not None:
        sets["title"] = S.clean_text(body.title, 160)
    if body.issuer is not None:
        sets["issuer"] = S.clean_text(body.issuer, 120)
    for k in ("date", "link", "share"):
        if getattr(body, k) is not None:
            sets[k] = getattr(body, k)
    c = (
        await db[CERTIFICATES].find_one_and_update(
            {"_id": cert_id, "user_id": auth.user.id}, {"$set": sets}, projection=S.LIST_FIELDS, return_document=True
        )
        if sets
        else await db[CERTIFICATES].find_one({"_id": cert_id, "user_id": auth.user.id}, S.LIST_FIELDS)
    )
    if not c:
        raise NOT_FOUND
    return S.out(c)


@router.delete("/{cert_id}", status_code=204)
async def delete_cert(cert_id: str, auth: CustomerAuth, db: DB) -> Response:
    r = await db[CERTIFICATES].delete_one({"_id": cert_id, "user_id": auth.user.id})
    if not r.deleted_count:
        raise NOT_FOUND
    return Response(status_code=204)


@router.get("/{cert_id}/file")
async def cert_file(cert_id: str, auth: CustomerAuth, db: DB) -> Response:
    c = await db[CERTIFICATES].find_one({"_id": cert_id, "user_id": auth.user.id})
    if not c:
        raise NOT_FOUND
    return Response(bytes(c["file"]), media_type=c["mime"], headers=S.file_response_headers(c))


@router.put("/sharing")
async def set_sharing(body: SharingIn, auth: CustomerAuth, db: DB) -> dict[str, Any]:
    await db[USERS].update_one({"_id": auth.user.id}, {"$set": {"cert_share": body.on}})
    return {"share": body.on}
