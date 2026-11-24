"""Rebranding the older articles for nm7.si, at read time (the posts in Hygraph are never changed).

- Brand words: "Team Asuraa" -> "Team Nm7", "Asuraa Team" -> "Nm7 Team", "Asuraa" -> "Nm7", "asuraa.in" -> "nm7.si",
  an @asuraa.in email address -> the site's support address.
- Links: an asuraa.in page (or a relative link, which pointed at asuraa.in) -> the matching nm7.si/blog/<slug> when that
  article is on nm7.si, else https://nm7.si.
- asuraa.ai (a separate product) is never changed, nor "Asuraa AI" / "AsuraaX": those are listed by `flags()` for a
  person to look at.
- After all that, no string anywhere in a post contains "asuraa.in" (`scrub`, the last safety net).
"""

import re
import unicodedata
from collections.abc import Callable, Iterable
from typing import Any

from app.core.config import get_settings

SITE = "https://nm7.si"

# old About Asuraa articles, rewritten by hand for Nm7 under new slugs in the site's own blog
RENAMED_SLUGS = {
    "what-is-asuraa": "what-is-nm7",
    "how-to-use-asuraa-to-find-jobs": "how-to-use-nm7-to-find-jobs",
    "is-asuraa-free-and-how-we-verify-jobs": "is-nm7-free-and-how-we-verify-jobs",
}

# never rewritten: the separate asuraa.ai product (any URL on it) and the names "Asuraa AI" / "AsuraaX"
_PROTECT = re.compile(
    r"(?:https?://)?(?:[\w-]+\.)*asuraa\.ai\b[^\s)\]>\"'<]*|\bAsuraaX(?:\s+AI)?\b|\bAsuraa\s+AI\b", re.IGNORECASE
)
_FLAG = re.compile(r"(?:[\w-]+\.)*asuraa\.ai\b|\bAsuraaX\b|\bAsuraa\s+AI\b", re.IGNORECASE)
_EMAIL = re.compile(r"\b[\w.+-]+@(?:www\.)?asuraa\.in\b", re.IGNORECASE)
_URL_IN_TEXT = re.compile(r"\bhttps?://(?:www\.)?asuraa\.in(?![\w-])[^\s)\]>\"'<]*", re.IGNORECASE)
_DOMAIN = re.compile(r"(?:www\.)?asuraa\.in(?![\w-])", re.IGNORECASE)
_WORDS = [
    (re.compile(r"\bthe\s+asuraa\s+team\b", re.IGNORECASE), "the Nm7 Team"),
    (re.compile(r"\bteam\s+asuraa\b", re.IGNORECASE), "Team Nm7"),
    (re.compile(r"\basuraa\s+team\b", re.IGNORECASE), "Nm7 Team"),
    (re.compile(r"\basuraain\b", re.IGNORECASE), "Nm7"),
    (re.compile(r"\basuraa\b", re.IGNORECASE), "Nm7"),
]
_HOST = re.compile(r"^(?:https?:)?//(?:www\.)?asuraa\.in(?![\w-])(?P<rest>[^\s]*)$", re.IGNORECASE)
_BARE_HOST = re.compile(r"^(?:www\.)?asuraa\.in(?![\w-])(?P<rest>[^\s]*)$", re.IGNORECASE)
_BLOG_PATH = re.compile(r"^/blog/([a-z0-9][a-z0-9-]*)/?$", re.IGNORECASE)


def _support_email() -> str:
    return get_settings().support_inbox or "info@nm7.si"


class Linker:
    """Where an old link goes: the slugs that are on nm7.si and the old slugs that now live under another one."""

    def __init__(self, slugs: Iterable[str] = (), aliases: dict[str, str] | None = None):
        self.slugs = {s.lower() for s in slugs}
        self.aliases = {**RENAMED_SLUGS, **{k.lower(): v for k, v in (aliases or {}).items()}}

    def blog_url(self, slug: str) -> str | None:
        s = slug.lower()
        s = self.aliases.get(s, s)
        return f"{SITE}/blog/{s}" if s in self.slugs or s in RENAMED_SLUGS.values() else None

    def path_url(self, path: str) -> str:
        """A path on asuraa.in -> its nm7.si address."""
        path = re.split(r"[?#]", path, maxsplit=1)[0] or "/"
        if m := _BLOG_PATH.match(path):
            return self.blog_url(m[1]) or SITE
        if path.rstrip("/").lower() == "/blog":
            return f"{SITE}/blog"
        return SITE

    def href(self, href: str | None) -> str:
        """A link target in an older article -> the one nm7.si shows."""
        h = str(href or "").strip()
        if not h or h.startswith("#") or _PROTECT.fullmatch(h):
            return h
        if h.lower().startswith("mailto:"):
            return f"mailto:{_support_email()}" if _DOMAIN.search(h) else h
        if m := _HOST.match(h) or _BARE_HOST.match(h):
            rest = m["rest"]
            return self.path_url(rest if rest.startswith("/") else "/")
        if h.startswith("/") and not h.startswith("//"):  # relative: a page on asuraa.in
            return self.path_url(h)
        return h

    def text(self, s: str | None) -> str:
        """Brand words in a piece of text."""
        if not s:
            return s or ""
        kept: list[str] = []

        def hold(m: re.Match) -> str:
            kept.append(m[0])
            return f"{len(kept) - 1}"

        out = _PROTECT.sub(hold, s)
        out = _EMAIL.sub(lambda _m: _support_email(), out)

        def url(m: re.Match) -> str:
            core = m[0].rstrip(".,;:!?")
            return self.href(core) + m[0][len(core) :]

        out = _URL_IN_TEXT.sub(url, out)
        out = _DOMAIN.sub("nm7.si", out)
        for rx, to in _WORDS:
            out = rx.sub(to, out)
        return re.sub("(\\d+)", lambda m: kept[int(m[1])], out)

    def ast(self, node: Any) -> Any:
        """A Rich Text tree with every text rebranded and every link mapped (a new tree)."""
        if isinstance(node, list):
            return [self.ast(n) for n in node]
        if not isinstance(node, dict):
            return node
        out: dict[str, Any] = {}
        for k, v in node.items():
            if k == "href":
                out[k] = self.href(v)
            elif k == "src" and isinstance(v, str):
                out[k] = v
            elif isinstance(v, str) and k in ("text", "title", "altText", "caption"):
                out[k] = self.text(v)
            else:
                out[k] = self.ast(v)
        if out.get("type") == "image" and _DOMAIN.search(str(out.get("src") or "")):
            return {"type": "paragraph", "children": [{"text": ""}]}  # an image on asuraa.in: not shown
        return out


def scrub(value: Any) -> Any:
    """Every string in a value with any "asuraa.in" left turned into "nm7.si" (the last safety net)."""
    if isinstance(value, str):
        return _DOMAIN.sub("nm7.si", value) if "asuraa" in value.lower() else value
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    return value


def find_mentions(text: str | None) -> list[str]:
    """Snippets around each asuraa.ai / "Asuraa AI" / "AsuraaX" mention in a text (for the flag list)."""
    s = str(text or "")
    out = []
    for m in _FLAG.finditer(s):
        a, b = max(0, m.start() - 60), min(len(s), m.end() + 60)
        out.append(re.sub(r"\s+", " ", ("…" if a else "") + s[a:b] + ("…" if b < len(s) else "")).strip())
    return out


def walk_strings(node: Any, visit: Callable[[str, str], None], key: str = "") -> None:
    if isinstance(node, str):
        visit(key, node)
    elif isinstance(node, list):
        for n in node:
            walk_strings(n, visit, key)
    elif isinstance(node, dict):
        for k, v in node.items():
            walk_strings(v, visit, k)


def norm_title(title: str | None) -> str:
    """A title for spotting duplicates: rebranded, lower case, letters, marks and digits only (any script)."""
    s = Linker().text(title or "").lower()
    keep = "".join(c if unicodedata.category(c)[0] in "LMN" else " " for c in s)
    return " ".join(keep.split())
