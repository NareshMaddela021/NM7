"""Reads a DigiLocker issued-document XML (the "Certificate" format issuers publish through DigiLocker) into a RawDoc.

The shape, as issuers publish it (needs vendor docs confirmation for each issuer; the reader is tolerant on purpose):

  <Certificate type="DRVLC" number="…" issueDate="…" expiryDate="…">
    <IssuedBy><Organization name="Transport Department" code="…"/></IssuedBy>
    <IssuedTo><Person name="…" dob="…" uid="(Aadhaar: never kept)" …><Photo>…</Photo></Person></IssuedTo>
    <CertificateData> … issuer-specific: <Categories><Category abbreviation="LMV" …/></Categories>,
                      <Examination name="…" year="…"/>, <Performance result="PASS"/>, <Course name="B.Tech"/> …
    </CertificateData>
  </Certificate>

Everything goes into RawDoc.data unfiltered; service.keep() decides what is stored. The XML text is never stored.
Entity declarations are refused (no XXE / billion laughs) before parsing.
"""

import re
import xml.etree.ElementTree as ET
from typing import Any

from app.trust.digilocker.providers import RawDoc

MAX_BYTES = 2_000_000


def _date(v: str) -> str:
    """YYYY-MM-DD from the usual DigiLocker forms (DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD…), else ""."""
    v = (v or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", v)
    if m:
        return f"{m[1]}-{m[2]}-{m[3]}"
    m = re.match(r"^(\d{2})[-/.](\d{2})[-/.](\d{4})", v)
    if m:
        return f"{m[3]}-{m[2]}-{m[1]}"
    return ""


def _tag(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1]


def parse(xml: str | bytes) -> RawDoc | None:
    raw = xml.encode() if isinstance(xml, str) else xml
    if not raw or len(raw) > MAX_BYTES or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        return None
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return None
    cert = root if _tag(root) == "Certificate" else next((e for e in root.iter() if _tag(e) == "Certificate"), None)
    if cert is None:
        return None
    a = cert.attrib
    org = next((e for e in cert.iter() if _tag(e) == "Organization"), None)
    person = next((e for e in cert.iter() if _tag(e) == "Person"), None)
    data: dict[str, Any] = {"person": dict(person.attrib) if person is not None else {}}
    classes: list[str] = []
    valid = _date(a.get("expiryDate") or a.get("validTo") or "")
    for e in cert.iter():
        t, at = _tag(e), e.attrib
        if t == "Category" and at.get("abbreviation"):
            classes.append(at["abbreviation"])
            for k in ("expiryDate", "validTo", "nonTransportValidTo", "transportValidTo"):
                valid = max(valid, _date(at.get(k, "")))
        elif t in ("DrivingLicense", "DrivingLicence"):
            for k in ("expiryDate", "validTo", "nonTransportValidTo", "transportValidTo"):
                valid = max(valid, _date(at.get(k, "")))
        elif t == "Examination":
            data["examination"] = at.get("name", "")
            if at.get("year"):
                data["year"] = at["year"]
        elif t in ("Performance", "Result"):
            data["result"] = at.get("result") or at.get("status") or (e.text or "")
        elif t in ("Course", "Degree", "Programme", "Program"):
            data["degree"] = at.get("name") or at.get("degree") or (e.text or "").strip()
            if at.get("year") or at.get("passingYear"):
                data["year"] = at.get("year") or at.get("passingYear")
        elif t == "Photo":
            data["photo"] = "(present)"
    if classes:
        data["classes"] = classes
    if "year" not in data:
        d = _date(a.get("issueDate", ""))
        if d:
            data["year"] = d[:4]
    return RawDoc(
        doc_type=(a.get("type") or "").upper(),
        issuer=(org.attrib.get("name", "") if org is not None else ""),
        name=(person.attrib.get("name", "") if person is not None else ""),
        number=a.get("number", ""),
        valid_until=valid,
        data=data,
    )
