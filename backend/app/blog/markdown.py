"""Markdown -> the Rich Text AST Hygraph's `content { raw }` returns, so the site renders the older articles (stored as
Markdown in the "Team Nm7" project) with the same escaping and the same allow-list of tags as its own posts
(frontend/src/lib/blog/richtext.js). A port of the site's former markdown.js.

Supported: # headings, paragraphs, - / * / 1. lists (nested by indentation), > quotes, ``` code blocks, | tables,
**bold**, *italic* / _italic_, `code`, [links](url). Anything else stays plain text, never HTML. Link targets are kept
as written here; app/blog/rebrand.py maps them.
"""

import re
from typing import Any

Node = dict[str, Any]


def _t(text: str, marks: dict[str, bool]) -> Node:
    return {"text": text, **marks}


_ESCAPABLE = set("\\`*_[]()#|>-")
_CODE = re.compile(r"`([^`]+)`")
_LINK = re.compile(r'\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)')
_BOLD = re.compile(r"(\*\*|__)(?=\S)([\s\S]*?\S)\1")
_ITALIC_STAR = re.compile(r"\*(?=\S)([^*]*?\S)\*")
_ITALIC_UNDER = re.compile(r"_(?=\S)([^_]*?\S)_(?![A-Za-z0-9])")


def inline(src: str, marks: dict[str, bool] | None = None) -> list[Node]:
    """Inline Markdown -> leaves and link nodes."""
    marks = marks or {}
    out: list[Node] = []
    buf: list[str] = []

    def flush() -> None:
        if buf:
            out.append(_t("".join(buf), marks))
            buf.clear()

    i = 0
    while i < len(src):
        c = src[i]
        if c == "\\" and i + 1 < len(src) and src[i + 1] in _ESCAPABLE:
            buf.append(src[i + 1])
            i += 2
            continue
        if m := _CODE.match(src, i):
            flush()
            out.append(_t(m[1], {**marks, "code": True}))
            i = m.end()
            continue
        if m := _LINK.match(src, i):
            flush()
            out.append({"type": "link", "href": m[2], "children": inline(m[1], marks)})
            i = m.end()
            continue
        if m := _BOLD.match(src, i):
            flush()
            out.extend(inline(m[2], {**marks, "bold": True}))
            i = m.end()
            continue
        m = _ITALIC_STAR.match(src, i) or _ITALIC_UNDER.match(src, i)
        if m:
            if c == "_" and buf and re.search(r"[A-Za-z0-9]$", buf[-1]):  # snake_case stays text
                buf.append("_")
                i += 1
                continue
            flush()
            out.extend(inline(m[1], {**marks, "italic": True}))
            i = m.end()
            continue
        buf.append(c)
        i += 1
    flush()
    return out or [_t("", marks)]


_HEADING = ["heading-one", "heading-two", "heading-three", "heading-four", "heading-five", "heading-six"]
_LIST = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")
_ROW = re.compile(r"^\s*\|.*\|\s*$")
_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def _indent(s: str) -> int:
    s = s.replace("\t", "    ")
    return len(s) - len(s.lstrip(" "))


def _cells(s: str) -> list[str]:
    s = s.strip()
    s = s[1:] if s.startswith("|") else s
    s = s[:-1] if s.endswith("|") else s
    return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", s)]


def _list(lines: list[str], start: int) -> tuple[Node, int]:
    base = _indent(lines[start])
    first = _LIST.match(lines[start])
    assert first
    ordered = first[2][0].isdigit()
    items: list[Node] = []
    i = start
    while i < len(lines):
        m = _LIST.match(lines[i])
        if not m or _indent(lines[i]) != base or m[2][0].isdigit() != ordered:
            break
        text = m[3]
        i += 1
        while i < len(lines) and lines[i].strip() and not _LIST.match(lines[i]) and _indent(lines[i]) > base:
            text += f" {lines[i].strip()}"
            i += 1
        kids: list[Node] = [{"type": "list-item-child", "children": inline(text)}]
        while i < len(lines) and _LIST.match(lines[i]) and _indent(lines[i]) > base:
            sub, i = _list(lines, i)
            kids.append(sub)
        items.append({"type": "list-item", "children": kids})
        # a single blank line between items of the same list keeps the list going
        if i + 1 < len(lines) and not lines[i].strip() and _LIST.match(lines[i + 1]) and _indent(lines[i + 1]) == base:
            i += 1
    return {"type": "numbered-list" if ordered else "bulleted-list", "children": items}, i


_PARA_STOP = re.compile(r"^\s*(#{1,6}\s|>|```|~~~)")


def markdown_to_ast(md: str | None) -> Node:
    """A Markdown document -> `{"children": [...]}` in Hygraph's Rich Text shape."""
    lines = re.sub(r"\r\n?", "\n", md or "").split("\n")
    out: list[Node] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if m := re.match(r"^\s*(```|~~~)", line):
            fence = m[1]
            code = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith(fence):
                code.append(lines[i])
                i += 1
            i += 1
            out.append({"type": "code-block", "children": [_t("\n".join(code), {})]})
            continue
        if m := re.match(r"^(#{1,6})\s+(.*?)\s*#*\s*$", line):
            out.append({"type": _HEADING[len(m[1]) - 1], "children": inline(m[2])})
            i += 1
            continue
        if re.match(r"^\s*([-*_])(\s*\1){2,}\s*$", line):  # horizontal rule: dropped
            i += 1
            continue
        if _ROW.match(line) and i + 1 < len(lines) and _SEP.match(lines[i + 1]):
            head = _cells(line)
            rows = []
            i += 2
            while i < len(lines) and _ROW.match(lines[i]):
                rows.append(_cells(lines[i]))
                i += 1

            def cell(kind: str, text: str) -> Node:
                return {"type": kind, "children": [{"type": "paragraph", "children": inline(text)}]}

            out.append(
                {
                    "type": "table",
                    "children": [
                        {
                            "type": "table_head",
                            "children": [
                                {"type": "table_row", "children": [cell("table_header_cell", h) for h in head]}
                            ],
                        },
                        {
                            "type": "table_body",
                            "children": [
                                {
                                    "type": "table_row",
                                    "children": [
                                        cell("table_cell", r[k] if k < len(r) else "") for k in range(len(head))
                                    ],
                                }
                                for r in rows
                            ],
                        },
                    ],
                }
            )
            continue
        if re.match(r"^\s*>", line):
            quote = []
            while i < len(lines) and re.match(r"^\s*>", lines[i]):
                quote.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            out.append({"type": "block-quote", "children": inline(" ".join(quote).strip())})
            continue
        if _LIST.match(line):
            node, i = _list(lines, i)
            out.append(node)
            continue
        para = [line.strip()]
        i += 1
        while (
            i < len(lines)
            and lines[i].strip()
            and not _PARA_STOP.match(lines[i])
            and not _LIST.match(lines[i])
            and not (_ROW.match(lines[i]) and _SEP.match(lines[i + 1] if i + 1 < len(lines) else ""))
        ):
            para.append(lines[i].strip())
            i += 1
        out.append({"type": "paragraph", "children": inline(" ".join(para))})
    return {"children": out}
