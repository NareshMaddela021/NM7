"""Round L: the job collector's summaries all failed with an Anthropic 400 in under a second: its structured-output
schema had objects without `additionalProperties: false`, which the API refuses. Every schema sent to Claude is
checked here, and the shared client makes any schema strict before it is sent."""

import importlib
import pathlib
import re

from app.core import claude

# every schema sent to Claude, by the module-level name each call site passes
SENT = {
    "app.jobs.collector": ["SCHEMA"], "app.companies.jobcheck": ["AI_SCHEMA", "WRITE_SCHEMA"],
    "app.projects.helper": ["SCHEMA"], "app.summary.writer": ["SCHEMA"], "app.linkedin.pack_writer": ["SCHEMA"],
    "app.linkedin.writer": ["SCHEMA"], "app.jobsearch.interview": ["SCHEMA", "FEEDBACK_SCHEMA"],
    "app.jobsearch.ai": ["SCHEMA"], "app.jobsearch.cover": ["SCHEMA"], "app.jobsearch.tailor": ["SCHEMA"],
    "app.photos.reader": ["SCHEMA"], "app.seek.offers": ["EXPLAIN_SCHEMA"], "app.seek.roles": ["SCHEMA"],
}  # fmt: skip
APP = pathlib.Path(__file__).resolve().parents[1] / "app"


def test_every_schema_sent_to_claude_is_strict_as_written():
    for name, attrs in SENT.items():
        mod = importlib.import_module(name)
        for attr in attrs:
            schema = getattr(mod, attr)
            assert claude.schema_problems(schema) == [], f"{name}.{attr}: {claude.schema_problems(schema)}"


def test_no_call_site_is_missed():
    """A new structured-output call must be listed above (so its schema is checked here)."""
    calling = set()
    for f in APP.rglob("*.py"):
        if f.name == "claude.py":
            continue
        text = f.read_text()
        if "ask_models(" in text or "claude.ask(" in text or "messages.create(" in text:
            calling.add(".".join(f.relative_to(APP.parent).with_suffix("").parts))
    assert calling == set(SENT), calling ^ set(SENT)
    # and each listed name is the one passed (or an inline dict schema has crept back in)
    for name, attrs in SENT.items():
        src = (APP.parent / pathlib.Path(*name.split("."))).with_suffix(".py").read_text()
        for m in re.finditer(r"ask_models\(", src):
            call = src[m.end() : m.end() + 200]  # the feature, the content and the schema come first
            assert any(re.search(rf"\b{a}\b", call) for a in attrs), f"{name}: a schema not in SENT: {call[:120]}"


def test_the_client_makes_any_schema_strict():
    a = {"type": ["object", "null"], "properties": {"x": {"type": "number"}}}
    b = {"type": "array", "items": {"type": "object", "properties": {}}}
    loose = {"type": "object", "properties": {"a": a, "b": b}, "required": ["a"]}
    assert len(claude.schema_problems(loose)) == 4
    fixed = claude.strict_schema(loose)
    assert claude.schema_problems(fixed) == []
    assert fixed["properties"]["a"] == {"anyOf": [{"type": "object", "properties": {"x": {"type": "number"}},
                                                   "additionalProperties": False}, {"type": "null"}]}  # fmt: skip
    assert "additionalProperties" not in loose  # the caller's schema is left alone
    assert claude.as_blocks("hi") == [{"type": "text", "text": "hi"}]
