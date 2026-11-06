"""Company sign-up checks (Phase 2, C1): registration numbers, email domains, website domain match, MX records.

Nothing here calls a paid registry: GSTIN, CIN and LLPIN are checked for their format (and GSTIN for its check
character); an admin then looks the number up by hand on the government site (Admin → Companies shows the link).
"""

import re
from urllib.parse import urlparse

# ---------- registration numbers ----------

_GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
GSTIN_RE = re.compile(r"^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$")
GST_STATES = {f"{n:02d}" for n in range(1, 39)} | {"97", "99"}
CIN_RE = re.compile(r"^[LU]\d{5}[A-Z]{2}\d{4}(PLC|PTC|FTC|GOI|SGC|NPL|GAP|GAT|ULL|ULT|OPC|FLC)\d{6}$")
LLPIN_RE = re.compile(r"^[A-Z]{3}-\d{4}$")
GST_PORTAL = "https://services.gst.gov.in/services/searchtp"
MCA_PORTAL = "https://www.mca.gov.in/content/mca/global/en/mca/master-data/MDS.html"


def gstin_check_char(first14: str) -> str:
    total = 0
    for i, c in enumerate(first14):
        p = _GST_CHARS.index(c) * (2 if i % 2 else 1)
        total += p // 36 + p % 36
    return _GST_CHARS[(36 - total % 36) % 36]


def clean_number(v: str) -> str:
    return re.sub(r"\s+", "", (v or "").upper())


def check_registration(kind: str, number: str) -> str | None:
    """None when the number looks right for its kind, else a plain reason."""
    n = clean_number(number)
    if kind == "gstin":
        m = GSTIN_RE.match(n)
        if not m:
            return "A GSTIN has 15 characters, like 27AAPFU0939F1ZV."
        if m.group(1) not in GST_STATES:
            return "The first two digits of a GSTIN are a state code (01–38)."
        if gstin_check_char(n[:14]) != n[14]:
            return "This GSTIN’s last character doesn’t match (a typing mistake?)."
        return None
    if kind == "cin":
        return None if CIN_RE.match(n) else "A CIN has 21 characters, like U72900TG2019PTC123456."
    if kind == "llpin":
        return None if LLPIN_RE.match(n) else "An LLPIN looks like AAB-1234."
    return "Pick GSTIN, CIN or LLPIN."


# ---------- email domains ----------

FREE_DOMAINS = frozenset(
    "gmail.com googlemail.com yahoo.com yahoo.co.in yahoo.in ymail.com rocketmail.com outlook.com outlook.in "
    "hotmail.com hotmail.co.in live.com live.in msn.com icloud.com me.com mac.com aol.com rediffmail.com rediff.com "
    "protonmail.com proton.me pm.me zohomail.in zohomail.com zoho.com gmx.com gmx.net mail.com yandex.com yandex.ru "
    "inbox.com hushmail.com tutanota.com tuta.io fastmail.com indiatimes.com sify.com".split()
)
DISPOSABLE_DOMAINS = frozenset(
    "mailinator.com guerrillamail.com guerrillamail.net guerrillamail.org sharklasers.com grr.la 10minutemail.com "
    "10minutemail.net tempmail.com temp-mail.org temp-mail.io tempmail.net tempmailo.com throwawaymail.com "
    "yopmail.com yopmail.net yopmail.fr getnada.com nada.email dispostable.com maildrop.cc mailnesia.com "
    "trashmail.com trashmail.de trashmail.net mintemail.com mohmal.com emailondeck.com fakeinbox.com spamgourmet.com "
    "mailcatch.com moakt.com tempr.email discard.email burnermail.io 33mail.com spambox.us inboxkitten.com "
    "emailfake.com fakemail.net tempinbox.com mytemp.email tmpmail.org tmpmail.net mail.tm mail.gw linshiyouxiang.net "
    "byom.de wegwerfmail.de einrot.com mailpoof.com mailsac.com harakirimail.com mvrht.com 1secmail.com 1secmail.org "
    "1secmail.net emltmp.com dropmail.me minuteinbox.com spam4.me tempail.com crazymailing.com mailtemp.info "
    "luxusmail.org cuvox.de armyspy.com dayrep.com fleckens.hu gustr.com jourrapide.com rhyta.com superrito.com "
    "teleworm.us".split()
)
BLOCKED_DOMAINS = frozenset({"asuraa.in"})  # Nm7 never takes @asuraa.in addresses

# two-part public suffixes common in India and elsewhere (no full public-suffix list needed for the match check)
_TWO_PART = frozenset(
    "co.in org.in net.in firm.in gen.in ind.in ac.in edu.in res.in gov.in nic.in co.uk org.uk ac.uk com.au net.au "
    "co.nz com.sg com.my co.za".split()
)


def email_domain(email: str) -> str:
    return (email or "").rsplit("@", 1)[-1].strip().lower().rstrip(".")


def site_domain(website: str) -> str:
    v = (website or "").strip()
    if not re.match(r"^[a-z]+://", v, re.I):
        v = "https://" + v
    host = (urlparse(v).hostname or "").lower().rstrip(".")
    return host[4:] if host.startswith("www.") else host


def registrable(host: str) -> str:
    """acme.co.in for hr.acme.co.in; acme.com for mail.acme.com."""
    parts = host.split(".")
    if len(parts) >= 3 and ".".join(parts[-2:]) in _TWO_PART:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def email_problem(email: str, *, company: bool, website: str = "") -> str | None:
    """None when this address can be used; else why not. Company addresses must be on the website's own domain."""
    d = email_domain(email)
    if not d or "." not in d:
        return "Enter a full email address."
    if d in BLOCKED_DOMAINS or registrable(d) in BLOCKED_DOMAINS:
        return "This email address can’t be used on Nm7."
    if d in DISPOSABLE_DOMAINS or registrable(d) in DISPOSABLE_DOMAINS:
        return "Throwaway email addresses aren’t accepted. Use an address you keep."
    if company:
        if d in FREE_DOMAINS:
            return "Use your company email (on your website’s domain), not Gmail, Yahoo, Outlook or similar."
        sd = site_domain(website)
        if not sd or registrable(d) != registrable(sd):
            return f"The company email must be on your website’s domain ({registrable(sd) or 'your website'})."
    return None


def _test_domain(domain: str) -> bool:
    """Reserved test domains (RFC 2606: .example, .test, .invalid) on a dev server: no DNS lookups (browser tests)."""
    from app.core.config import get_settings

    return get_settings().app_env == "dev" and domain.rsplit(".", 1)[-1] in ("example", "test", "invalid")


async def has_mx(domain: str) -> bool:
    """True when the domain can receive email (an MX record, or an A record as the fallback mail servers use).
    A DNS failure counts as False; the caller decides whether that blocks or only flags."""
    import dns.asyncresolver
    import dns.exception

    if _test_domain(domain):
        return True
    r = dns.asyncresolver.Resolver()
    r.lifetime = 4.0
    for kind in ("MX", "A"):
        try:
            ans = await r.resolve(domain, kind)
            if len(ans):
                return True
        except (dns.exception.DNSException, OSError):
            continue
    return False


async def domain_age_days(domain: str, client=None) -> int | None:
    """Days since the domain was registered, from the public RDAP registry (free, no key). None when unknown."""
    from datetime import UTC, datetime

    import httpx

    if _test_domain(domain):
        return None
    own = client is None
    client = client or httpx.AsyncClient(timeout=5.0, follow_redirects=True)
    try:
        r = await client.get(f"https://rdap.org/domain/{registrable(domain)}")
        if r.status_code != 200:
            return None
        for e in r.json().get("events") or []:
            if e.get("eventAction") == "registration" and e.get("eventDate"):
                at = datetime.fromisoformat(e["eventDate"].replace("Z", "+00:00"))
                return max(0, (datetime.now(UTC) - at).days)
        return None
    except (httpx.HTTPError, ValueError, KeyError):
        return None
    finally:
        if own:
            await client.aclose()
