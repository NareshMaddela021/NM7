"""Resume text with bold words: the builder stores **word** markers inside the summary and the descriptions of
experience, projects, achievements and custom sections. On save those fields keep text + bold only: <b>/<strong>
become markers and other formatting tags are left out (a word like "<Button>" in a developer's bullet stays).
Anything that is not a resume picture (CSV, e-mails) uses the text without markers."""

import re
from typing import Any

BOLD_TAG = re.compile(r"</?(?:b|strong)(?:\s[^>]*)?>", re.I)
TAG = re.compile(
    r"</?(?:i|em|u|s|strike|del|ins|mark|small|big|sup|sub|span|font|div|p|br|hr|a|ul|ol|li|dl|dt|dd|h[1-6]|table|"
    r"thead|tbody|tfoot|tr|td|th|section|article|header|footer|blockquote|pre|code|img|meta|link|style|script|o:p|"
    r"w:[a-z]+)(?:\s[^>]*)?/?>",
    re.I,
)
BREAK = re.compile(r"<br\s*/?>|</(?:p|div|li|h[1-6]|tr)>", re.I)  # a line break or the end of a block
RICH_LISTS = ("exp", "proj", "ach")


def clean_rich_text(v: Any) -> Any:
    """Text + bold only (markers kept as typed)."""
    if not isinstance(v, str) or "<" not in v:
        return v
    out = TAG.sub("", BREAK.sub("\n", BOLD_TAG.sub("**", v)))
    return v if out == v else re.sub(r"\n{3,}", "\n\n", out).strip()


def plain(v: Any) -> Any:
    """The text without bold markers."""
    return v.replace("**", "") if isinstance(v, str) else v


def clean_rich(data: Any) -> Any:
    """A copy of resume data whose rich fields hold text + bold only; everything else is unchanged."""
    if not isinstance(data, dict):
        return data
    out = dict(data)
    if "summary" in out:
        out["summary"] = clean_rich_text(out["summary"])

    def items(lst: Any) -> Any:
        if not isinstance(lst, list):
            return lst
        return [
            {**x, "description": clean_rich_text(x["description"])} if isinstance(x, dict) and "description" in x else x
            for x in lst
        ]

    for k in RICH_LISTS:
        if k in out:
            out[k] = items(out[k])
    if isinstance(out.get("custom"), list):
        out["custom"] = [
            {**c, "items": items(c.get("items"))} if isinstance(c, dict) and "items" in c else c for c in out["custom"]
        ]
    return out
