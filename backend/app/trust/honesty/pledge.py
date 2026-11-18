# ruff: noqa: E501  (plain-language texts on one line each)
"""Vetting Trust T9: the honesty pledge. Before a skill check, a practical task and the AI interview, people Vetting
Trust is on for read a short plain promise and tick it to start. The server refuses to start without it (409
"pledge"), and records which version they agreed to, when and in which language, with the attempt / task / interview
(`pledge: {version, at, lang}`), so a reviewer sees it in the evidence view. It is a promise in plain words, not a
legal trap: nothing is decided by it, and it changes no score.

A changed text gets a new VERSION: a page that shows an older version is asked to show the new one (409 "pledge").
"""

from datetime import datetime
from typing import Any

from app.core.errors import ApiError

VERSION = 1
KINDS = ("skill", "task", "interview")
WHAT = {"skill": "Skill check", "task": "Practical task", "interview": "AI interview"}
TEXT = {
    "en": "I will answer on my own, without help from other people or AI tools (like ChatGPT). I won’t copy answers or let someone else do this for me. I understand Nm7 may check my answers and how the test was taken, and a person may ask me about them. Nothing is decided automatically.",
    "hi": "मेरे जवाब मेरे अपने होंगे: किसी दूसरे व्यक्ति या AI टूल (जैसे ChatGPT) की मदद के बिना। मैं जवाब कॉपी नहीं करूँगा/करूँगी और किसी और से यह नहीं करवाऊँगा/करवाऊँगी। मुझे पता है कि Nm7 मेरे जवाबों और टेस्ट देने के तरीके की जाँच कर सकता है, और कोई व्यक्ति मुझसे इनके बारे में पूछ सकता है। कुछ भी अपने आप तय नहीं होता।",
    "te": "నా జవాబులు నా సొంతవే: ఇతర వ్యక్తుల లేదా AI టూల్స్ (ChatGPT లాంటివి) సహాయం లేకుండా. జవాబులు కాపీ చేయను, నా బదులు వేరేవాళ్లతో చేయించను. Nm7 నా జవాబులను, పరీక్ష ఎలా రాశానో తనిఖీ చేయవచ్చని, ఒక వ్యక్తి వాటి గురించి నన్ను అడగవచ్చని నాకు తెలుసు. ఏదీ ఆటోమేటిక్‌గా నిర్ణయించబడదు.",
}
TICK = {
    "en": "I promise to answer honestly, on my own.",
    "hi": "मैं ईमानदारी से, खुद जवाब देने का वादा करता/करती हूँ।",
    "te": "నేను నిజాయితీగా, సొంతంగా జవాబులు ఇస్తానని మాట ఇస్తున్నాను.",
}
TITLE = {"en": "Your honesty pledge", "hi": "ईमानदारी का वादा", "te": "నిజాయితీ ప్రమాణం"}


def texts() -> dict[str, Any]:
    return {"version": VERSION, "title": TITLE, "text": TEXT, "tick": TICK}


async def needed(db, uid: str) -> bool:
    from app.trust import access

    return await access.for_user(db, uid)


async def check(db, uid: str, version: int | None, lang: str, t: datetime) -> dict[str, Any] | None:
    """The record to store with the attempt, None when Vetting Trust is off for this person (no pledge asked), or 409."""
    if not await needed(db, uid):
        return None
    if version != VERSION:
        raise ApiError(
            409,
            "pledge",
            "Please read the honesty pledge and tick it to start."
            if not version
            else "The pledge has changed. Please read it again and tick it to start.",
            extra={"pledge": texts()},
        )
    return {"version": VERSION, "at": t, "lang": lang if lang in TEXT else "en"}


def out(rec: dict[str, Any] | None) -> dict[str, Any] | None:
    from app.me.service import ms

    if not rec:
        return None
    return {"version": rec.get("version"), "at": ms(rec.get("at")), "lang": rec.get("lang", "en")}


async def records(db, uid: str, limit: int = 30) -> list[dict[str, Any]]:
    """Every pledge this person agreed to (newest first), for the T8 evidence view: what, which version, when, language."""
    from app.core.db import SKILL_ATTEMPTS, VETTING_INTERVIEWS

    rows: list[tuple[datetime, dict[str, Any]]] = []
    async for a in (
        db[SKILL_ATTEMPTS]
        .find(
            {"user_id": uid, "$or": [{"pledge": {"$exists": True}}, {"task.pledge": {"$exists": True}}]},
            {"skill": 1, "kind": 1, "pledge": 1, "task.pledge": 1},
        )
        .sort("started_at", -1)
        .limit(limit)
    ):
        if a.get("pledge"):
            what = f"{WHAT['skill']}{' (refresher)' if a.get('kind') == 'refresh' else ''}: {a.get('skill', '')}"
            rows.append((a["pledge"]["at"], {"what": what, "kind": "skill", "ref": str(a["_id"]), **out(a["pledge"])}))
        tp = (a.get("task") or {}).get("pledge")
        if tp:
            rows.append(
                (
                    tp["at"],
                    {"what": f"{WHAT['task']}: {a.get('skill', '')}", "kind": "task", "ref": str(a["_id"]), **out(tp)},
                )
            )
    async for iv in (
        db[VETTING_INTERVIEWS]
        .find({"user_id": uid, "pledge": {"$exists": True}}, {"test": 1, "pledge": 1})
        .sort("started_at", -1)
        .limit(limit)
    ):
        rows.append(
            (
                iv["pledge"]["at"],
                {
                    "what": f"{WHAT['interview']}: {iv.get('test', '')}",
                    "kind": "interview",
                    "ref": str(iv["_id"]),
                    **out(iv["pledge"]),
                },
            )
        )
    rows.sort(key=lambda r: r[1]["at"] or 0, reverse=True)
    return [r for _, r in rows[:limit]]
