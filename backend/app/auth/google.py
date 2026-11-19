"""Checking a "Sign in with Google" ID token on the server (Google Identity Services, the popup / One Tap flow).

The browser gets a signed ID token (a JWT) from Google and posts it to us; nothing else from Google is used: no
access token, no client secret. We check it ourselves with `cryptography` (already a dependency, so no JWT library is
added):

- the signature (RS256 only) against Google's public keys (JWKS), kept in memory for as long as Google's
  Cache-Control max-age says and fetched again when a token names a key we don't have (at most once a minute);
- aud == GOOGLE_CLIENT_ID, iss is Google, exp / iat with a minute of leeway;
- email_verified is true (an unverified Google address proves nothing about the email).

Only `sub`, `email`, `name` and `picture` leave this module. The token itself is never stored or logged.

Tests and the browser tests never reach Google: tests put keys in with `set_test_keys`, and the browser tests' API
reads GOOGLE_TEST_JWKS and GOOGLE_TEST_CLIENT_ID, which are ignored (with a warning) when APP_ENV is prod, the default.
"""

import base64
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from app.core.config import get_settings
from app.core.errors import ApiError

log = logging.getLogger("nm7.auth.google")

JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("accounts.google.com", "https://accounts.google.com")
LEEWAY = 60  # seconds, for clock differences
DEFAULT_MAX_AGE = 3600  # when Google's answer has no max-age
MIN_REFETCH = 60  # an unknown key id fetches the keys again at most this often
MAX_TOKEN = 4096

INVALID = ApiError(400, "google_invalid", "We couldn’t check this Google sign-in. Please try again.")
UNVERIFIED = ApiError(
    400,
    "google_unverified",
    "This Google account isn’t verified. Verify your email with Google, or sign in with your email and password.",
)
DISABLED = ApiError(404, "google_off", "Sign in with Google isn’t turned on.")


@dataclass(frozen=True)
class GoogleId:
    sub: str
    email: str
    name: str
    picture: str | None


class _Keys:
    def __init__(self) -> None:
        self.keys: dict[str, rsa.RSAPublicKey] = {}
        self.expires = 0.0
        self.fetched = 0.0
        self.fixed = False  # test keys: never fetched from Google


_cache = _Keys()


def _b64(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def _int(part: str) -> int:
    return int.from_bytes(_b64(part), "big")


def parse_jwks(data: dict[str, Any]) -> dict[str, rsa.RSAPublicKey]:
    out: dict[str, rsa.RSAPublicKey] = {}
    for k in data.get("keys") or []:
        if k.get("kty") == "RSA" and k.get("kid") and k.get("n") and k.get("e") and k.get("alg", "RS256") == "RS256":
            out[str(k["kid"])] = rsa.RSAPublicNumbers(_int(k["e"]), _int(k["n"])).public_key()
    return out


def max_age(cache_control: str | None) -> int:
    m = re.search(r"max-age=(\d+)", cache_control or "")
    return int(m.group(1)) if m else DEFAULT_MAX_AGE


async def fetch_jwks() -> tuple[dict[str, Any], int]:
    """Google's public keys and how many seconds they may be kept. Tests replace this (or use set_test_keys)."""
    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(JWKS_URL)
        r.raise_for_status()
        return r.json(), max_age(r.headers.get("cache-control"))


def set_test_keys(jwks: dict[str, Any] | None) -> None:
    """Tests: use these keys and never fetch; None goes back to Google's keys."""
    _cache.keys = parse_jwks(jwks) if jwks else {}
    _cache.fixed = jwks is not None
    _cache.expires = float("inf") if jwks else 0.0
    _cache.fetched = 0.0


def _load_env_keys() -> None:
    raw = get_settings().google_test_jwks
    if not raw or _cache.fixed:
        return
    if get_settings().is_prod:
        log.warning("GOOGLE_TEST_JWKS is set but ignored in production")
        return
    set_test_keys(json.loads(raw))


async def _key(kid: str) -> rsa.RSAPublicKey | None:
    _load_env_keys()
    t = time.monotonic()
    if _cache.fixed:
        return _cache.keys.get(kid)
    stale = t >= _cache.expires
    unknown = kid not in _cache.keys and t - _cache.fetched >= MIN_REFETCH
    if stale or unknown:
        try:
            data, age = await fetch_jwks()
        except (httpx.HTTPError, ValueError) as e:
            log.warning("could not fetch Google's keys: %s", type(e).__name__)
            if not _cache.keys:
                raise ApiError(503, "google_unavailable", "Google sign-in is busy. Please try again.") from None
        else:
            _cache.keys = parse_jwks(data)
            _cache.expires = t + max(60, age)
            _cache.fetched = t
    return _cache.keys.get(kid)


def client_id() -> str:
    """GOOGLE_CLIENT_ID, or (browser tests, never in production) GOOGLE_TEST_CLIENT_ID. The test one is not put in
    the site flags, so other browser tests never see a Google button; the Google test sets it in the page itself."""
    s = get_settings()
    return s.google_client_id.strip() or ("" if s.is_prod else s.google_test_client_id.strip())


def _client_id() -> str:
    cid = client_id()
    if not cid:
        raise DISABLED
    return cid


def enabled() -> bool:
    return bool(client_id())


async def verify(token: str) -> GoogleId:
    """The person behind a Google ID token, or ApiError. Never logs the token."""
    client_id = _client_id()
    if not token or len(token) > MAX_TOKEN or token.count(".") != 2:
        raise INVALID
    h, p, s = token.split(".")
    try:
        header = json.loads(_b64(h))
        claims = json.loads(_b64(p))
        sig = _b64(s)
    except (ValueError, UnicodeDecodeError):
        raise INVALID from None
    if not isinstance(header, dict) or not isinstance(claims, dict):
        raise INVALID
    if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str):
        raise INVALID
    key = await _key(header["kid"])
    if key is None:
        raise INVALID
    try:
        key.verify(sig, f"{h}.{p}".encode(), padding.PKCS1v15(), hashes.SHA256())
    except InvalidSignature:
        raise INVALID from None

    t = time.time()
    aud = claims.get("aud")
    if aud != client_id and not (isinstance(aud, list) and aud == [client_id]):
        raise INVALID
    if claims.get("iss") not in ISSUERS:
        raise INVALID
    exp, iat = claims.get("exp"), claims.get("iat")
    if not isinstance(exp, int | float) or not isinstance(iat, int | float):
        raise INVALID
    if exp < t - LEEWAY or iat > t + LEEWAY:
        raise INVALID
    sub, email = claims.get("sub"), claims.get("email")
    if not isinstance(sub, str) or not sub or len(sub) > 255 or not isinstance(email, str) or "@" not in email:
        raise INVALID
    if claims.get("email_verified") not in (True, "true"):
        raise UNVERIFIED
    name = claims.get("name") if isinstance(claims.get("name"), str) else ""
    picture = claims.get("picture") if isinstance(claims.get("picture"), str) else None
    if picture and (not picture.startswith("https://") or len(picture) > 500):
        picture = None
    return GoogleId(sub=sub, email=email.strip()[:254], name=" ".join(name.split())[:80], picture=picture)
