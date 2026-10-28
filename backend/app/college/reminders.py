"""WhatsApp / SMS reminders without paid services (feature `wa_reminders`: Drive and Campus plans).

There is no WhatsApp Business API or SMS gateway here (both are paid and need keys). Instead, from any "who's missing"
list a coordinator makes a batch: a ready message, and for each student a one-tap "Send on WhatsApp" link
(https://wa.me/<number>?text=<message>) that opens the coordinator's own WhatsApp, and on phones an "SMS" link
(sms:<number>?body=<message>). They tick each one sent ("18 of 40 sent"). A phone-list CSV is there for a WhatsApp
Business broadcast list. Email reminders stay as they are (placement dashboard).

Who is in a batch: active members who joined with consent, gave a mobile number on their account, and haven't
switched reminders off. The message may use only {name} (the student's first name) — nothing else about the student
goes into a link.

Staff (/api/org/{org_id}/wa-reminders):
  POST ""                          {membershipIds, message, channel: whatsapp | sms, list}: a batch
  GET  /{id}                       the batch: per student a link, sent or not, progress
  POST /{id}/sent                  {membershipId, sent}
  GET  /{id}/phones.csv            name, mobile (for a broadcast list)
  GET  /gateway                    whether a paid gateway is connected (never, for now)

`Gateway` is the interface a paid provider would implement later; `DisabledGateway` is what runs today.
"""

import csv
import io
import re
from typing import Any, Literal, Protocol
from urllib.parse import quote

from fastapi import APIRouter, Request, Response
from pydantic import Field, field_validator

from app.auth.models import new_id
from app.college.common import log, members_of, org_with, scoped_groups
from app.core.db import DB, REMINDER_BATCHES
from app.core.errors import ApiError
from app.core.exports import csv_safe
from app.core.schemas import CamelModel
from app.core.time import now
from app.me.service import ms
from app.orgs.scope import NOT_FOUND, OrgScope

staff = APIRouter(prefix="/api/org/{org_id}/wa-reminders", tags=["reminders"])

MAX_BATCH = 500
PLACEHOLDER = re.compile(r"\{(\w+)\}")


# ---------- the paid-gateway interface (not connected) ----------
class Gateway(Protocol):
    """What a paid WhatsApp Business / SMS provider would implement. Nothing calls it while it's disabled."""

    available: bool

    async def send(self, to: str, text: str) -> bool: ...


class DisabledGateway:
    available = False

    async def send(self, to: str, text: str) -> bool:  # pragma: no cover - never called while disabled
        raise RuntimeError("No paid messaging gateway is connected.")


GATEWAY: Gateway = DisabledGateway()


# ---------- models ----------
class BatchIn(CamelModel):
    membership_ids: list[str] = Field(min_length=1, max_length=MAX_BATCH)
    message: str = Field(min_length=5, max_length=600)
    channel: Literal["whatsapp", "sms"] = "whatsapp"
    list: str = Field("", max_length=60)  # which list it came from, for the Activity log

    @field_validator("message")
    @classmethod
    def _only_name(cls, v):
        v = v.strip()
        bad = {m for m in PLACEHOLDER.findall(v) if m != "name"}
        if bad:
            raise ValueError("Only {name} can be filled in for each student.")
        return v


class SentIn(CamelModel):
    membership_id: str = Field(max_length=64)
    sent: bool = True


def digits(phone: str | None) -> str | None:
    """+91 98765 43210 → 919876543210 (Indian mobiles, as stored on the account)."""
    d = re.sub(r"\D", "", phone or "")
    if len(d) == 10 and d[0] in "6789":
        d = f"91{d}"
    return d if len(d) == 12 and d.startswith("91") else None


def first_name(name: str) -> str:
    return (name or "").split(" ")[0] or "there"


def text_for(message: str, name: str) -> str:
    return message.replace("{name}", first_name(name))


def wa_link(phone: str, text: str) -> str:
    return f"https://wa.me/{phone}?text={quote(text, safe='')}"


def sms_link(phone: str, text: str) -> str:
    return f"sms:+{phone}?body={quote(text, safe='')}"


def batch_out(b: dict[str, Any]) -> dict[str, Any]:
    items = []
    for it in b["items"]:
        text = text_for(b["message"], it["name"])
        items.append(
            {
                "membershipId": it["membership_id"],
                "name": it["name"],
                "roll": it.get("roll", ""),
                "whatsapp": wa_link(it["phone"], text),
                "sms": sms_link(it["phone"], text),
                "sent": bool(it.get("sent_at")),
            }
        )
    sent = sum(i["sent"] for i in items)
    return {
        "id": b["_id"],
        "message": b["message"],
        "channel": b["channel"],
        "list": b.get("list", ""),
        "items": items,
        "sent": sent,
        "total": len(items),
        "skipped": b.get("skipped", {}),
        "createdAt": ms(b["created_at"]),
    }


async def _batch(db, scope, batch_id: str) -> dict[str, Any]:
    b = await db[REMINDER_BATCHES].find_one({"_id": batch_id, "org_id": scope.org_id})
    if not b or (scope.group_ids is not None and not set(b.get("group_ids", [])) <= set(scope.group_ids)):
        raise NOT_FOUND
    return b


@staff.get("/gateway")
async def gateway(db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "wa_reminders")
    return {"connected": GATEWAY.available}


@staff.post("", status_code=201)
async def make_batch(body: BatchIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "wa_reminders")
    scope.require("remind")
    people = await members_of(db, await scoped_groups(db, scope), list(dict.fromkeys(body.membership_ids)))
    skipped = {"noPhone": 0, "optedOut": 0}
    items = []
    for p in people:
        if p["_m"].get("reminders_opt_out"):
            skipped["optedOut"] += 1
            continue
        phone = digits(p["_u"].get("phone"))
        if not phone:
            skipped["noPhone"] += 1
            continue
        items.append({"membership_id": p["id"], "name": p["name"], "roll": p["roll"], "phone": phone, "sent_at": None})
    skipped["notFound"] = len(set(body.membership_ids)) - len(people)
    if not items:
        raise ApiError(400, "no_phones", "None of these students gave a mobile number and allowed reminders.")
    b = {
        "_id": new_id(),
        "org_id": scope.org_id,
        "group_ids": sorted({p["group_id"] for p in people}),
        "message": body.message,
        "channel": body.channel,
        "list": body.list,
        "items": items,
        "skipped": skipped,
        "created_by": scope.actor_id,
        "created_at": now(),
    }
    await db[REMINDER_BATCHES].insert_one(b)
    await log(db, scope, request, "wa_batch", b["_id"], count=len(items), channel=body.channel, list=body.list)
    return batch_out(b)


@staff.get("/{batch_id}")
async def get_batch(batch_id: str, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "wa_reminders")
    return batch_out(await _batch(db, scope, batch_id))


@staff.post("/{batch_id}/sent")
async def mark_sent(batch_id: str, body: SentIn, request: Request, db: DB, scope: OrgScope) -> dict[str, Any]:
    await org_with(db, scope, "wa_reminders")
    scope.require("remind")
    b = await _batch(db, scope, batch_id)
    if body.membership_id not in {i["membership_id"] for i in b["items"]}:
        raise NOT_FOUND
    await db[REMINDER_BATCHES].update_one(
        {"_id": batch_id, "items.membership_id": body.membership_id},
        {"$set": {"items.$.sent_at": now() if body.sent else None}},
    )
    await log(db, scope, request, "wa_sent", batch_id, member=body.membership_id, sent=body.sent)
    return batch_out(await _batch(db, scope, batch_id))


@staff.get("/{batch_id}/phones.csv")
async def phones_csv(batch_id: str, request: Request, db: DB, scope: OrgScope) -> Response:
    await org_with(db, scope, "wa_reminders")
    scope.require("export")
    b = await _batch(db, scope, batch_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Name", "Mobile"])
    for it in b["items"]:
        w.writerow([csv_safe(it["name"]), f"+{it['phone']}"])
    await log(db, scope, request, "wa_phones_csv", batch_id, count=len(b["items"]))
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="phone_list.csv"', "Cache-Control": "no-store"},
    )
