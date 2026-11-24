"""The older blog articles (Hygraph "Team Nm7"): read with the token, rebranded, deduplicated, cached, no asuraa.in."""

import json

import httpx
import pytest
import respx

from app.blog import legacy
from app.blog.markdown import markdown_to_ast
from app.blog.rebrand import Linker, norm_title
from app.core.config import get_settings

ENDPOINT = "https://hygraph.test/v2/team-nm7/master"
TOKEN = "test-token-not-a-secret"


def post(slug, title, body="Hello.", **kw):
    return {
        "id": slug,
        "slug": slug,
        "title": title,
        "excerpt": kw.get("excerpt", f"About {title}."),
        "seoTitle": kw.get("seoTitle"),
        "metaDescription": kw.get("metaDescription", "Read this on Asuraa."),
        "category": kw.get("category", "Resume Tips"),
        "body": body,
        "faq": kw.get("faq"),
        "publishedAt": kw.get("publishedAt", "2025-05-01T05:00:00.000Z"),
        "updatedAt": kw.get("updatedAt", kw.get("publishedAt", "2025-05-01T05:00:00.000Z")),
        "createdAt": kw.get("publishedAt", "2025-05-01T05:00:00.000Z"),
    }


BODY = """*Last updated: May 2025 · By the Asuraa Team*

# Resume tips from Team Asuraa

Asuraa helps freshers. Visit [our jobs page](https://asuraa.in/jobs) or read [keywords](https://www.asuraa.in/blog/ats-keywords-guide/).
A missing one: [old post](https://asuraa.in/blog/no-such-post) and a [relative one](/blog/ats-keywords-guide).
Write to hello@asuraa.in or [mail us](mailto:support@asuraa.in). Plain text: asuraa.in/blog/ats-keywords-guide.
Our sister product [Asuraa AI](https://asuraa.ai/cute) lives at asuraa.ai and is made by AsuraaX AI.
Moved: [what is it](https://asuraa.in/blog/what-is-asuraa).

- **Bold** item with `code`
- Item two

| Section | Tip |
|---|---|
| Skills | Match the asuraa.in job post |
"""

POSTS = [
    post(
        "resume-tips-freshers",
        "Resume tips from Asuraa",
        BODY,
        faq=[{"question": "Is Asuraa free?", "answer": "Yes, on asuraa.in."}],
    ),
    post("ats-keywords-guide", "ATS keywords guide", "Keywords matter.", publishedAt="2025-06-01T05:00:00.000Z"),
    # same title as the one above, older: dropped, its slug goes to the newer one
    post("ats-keywords-guide-old", "ATS Keywords Guide!", "Old copy.", publishedAt="2024-01-01T05:00:00.000Z"),
    # an old About Asuraa post that was rewritten for Nm7 under a new slug
    post("what-is-asuraa", "What is Asuraa?", "About us.", category="About Asuraa"),
    post("telugu-guide", "రెజ్యూమ్ గైడ్", "తెలుగు", category="Telugu Guides"),
]


@pytest.fixture
def hygraph(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "hygraph_token", TOKEN)
    monkeypatch.setattr(s, "hygraph_endpoint", ENDPOINT)
    legacy.CACHE.reset()
    with respx.mock(assert_all_called=False) as router:
        state = {"posts": POSTS, "fail": False, "calls": []}

        def answer(request):
            state["calls"].append(request)
            if state["fail"]:
                return httpx.Response(401, json={"errors": [{"message": "not allowed"}]})
            v = json.loads(request.content)["variables"]
            page = state["posts"][v["skip"] : v["skip"] + v["first"]]
            return httpx.Response(200, json={"data": {"blogPosts": page}})

        router.post(ENDPOINT).mock(side_effect=answer)
        yield state
    legacy.CACHE.reset()


async def all_posts(client):
    r = await client.get("/api/blog/legacy", params={"per_page": 200, "content": 1})
    assert r.status_code == 200, r.text
    return r.json()


async def test_off_without_a_token(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "hygraph_token", "")
    legacy.CACHE.reset()
    with respx.mock(assert_all_called=False) as router:
        route = router.post(url__regex=r".*hygraph.*").mock(return_value=httpx.Response(500))
        body = (await client.get("/api/blog/legacy")).json()
    assert body["configured"] is False and body["posts"] == [] and body["total"] == 0
    assert not route.called


async def test_reads_published_posts_with_the_token_only_on_the_server(client, hygraph):
    body = await all_posts(client)
    assert body["configured"] is True and body["error"] is None
    req = hygraph["calls"][0]
    assert req.headers["Authorization"] == f"Bearer {TOKEN}"
    q = json.loads(req.content)["query"]
    assert "stage: PUBLISHED" in q and "mutation" not in q
    assert TOKEN not in json.dumps(body)
    r = await client.get("/api/blog/legacy")
    assert r.headers["cache-control"] == "public, max-age=300"


async def test_dedupes_by_slug_and_title_keeping_the_newer(client, hygraph):
    body = await all_posts(client)
    slugs = [p["slug"] for p in body["posts"]]
    assert slugs == ["ats-keywords-guide", "resume-tips-freshers", "telugu-guide"]  # newest first
    assert body["aliases"] == {"ats-keywords-guide-old": "ats-keywords-guide", "what-is-asuraa": "what-is-nm7"}
    assert body["total"] == 3
    # an old slug answers with the article it moved to
    assert (await client.get("/api/blog/legacy/ats-keywords-guide-old")).json()["slug"] == "ats-keywords-guide"
    assert (await client.get("/api/blog/legacy/nope")).status_code == 404


async def test_rebrands_words_links_and_emails_but_not_asuraa_ai(client, hygraph):
    body = await all_posts(client)
    p = next(x for x in body["posts"] if x["slug"] == "resume-tips-freshers")
    assert p["title"] == "Resume tips from Nm7"
    assert p["seoDescription"] == "Read this on Nm7."
    assert p["faq"] == [{"question": "Is Nm7 free?", "answer": "Yes, on nm7.si."}]
    assert p["author"] is None and p["source"] == "legacy"
    assert p["category"] == {"name": "Resume Tips", "slug": "resume-tips"}
    text = json.dumps(p["content"], ensure_ascii=False)
    assert "Last updated" not in text  # the old byline line is dropped
    assert "Resume tips from Team Nm7" in text and "Nm7 helps freshers." in text
    links = {}

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "link":
                links["".join(c.get("text", "") for c in n["children"])] = n["href"]
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    walk(p["content"])
    assert links["our jobs page"] == "https://nm7.si"
    assert links["keywords"] == "https://nm7.si/blog/ats-keywords-guide"
    assert links["relative one"] == "https://nm7.si/blog/ats-keywords-guide"
    assert links["old post"] == "https://nm7.si"  # no such article on nm7.si
    assert links["mail us"] == "mailto:info@nm7.si"
    assert links["what is it"] == "https://nm7.si/blog/what-is-nm7"
    assert links["Asuraa AI"] == "https://asuraa.ai/cute"  # untouched
    assert "Write to info@nm7.si" in text
    assert "nm7.si/blog/ats-keywords-guide." in text
    assert "lives at asuraa.ai and is made by AsuraaX AI." in text
    assert "Match the nm7.si job post" in text


async def test_no_asuraa_in_anywhere_in_the_api(client, hygraph):
    for path in (
        "/api/blog/legacy",
        "/api/blog/legacy?content=1&per_page=200",
        "/api/blog/legacy/resume-tips-freshers",
    ):
        r = await client.get(path)
        assert "asuraa.in" not in r.text.lower(), path


async def test_flags_list_asuraa_ai_mentions_for_admins_only(client, hygraph):
    assert (await client.get("/api/admin/blog/flags")).status_code in (401, 403)
    b = await legacy.blog()
    texts = [f["text"] for f in b["flags"]]
    assert all(f["slug"] == "resume-tips-freshers" for f in b["flags"])
    assert any("asuraa.ai/cute" in t for t in texts) and any("AsuraaX AI" in t for t in texts)
    assert b["flags"][0]["url"] == "https://nm7.si/blog/resume-tips-freshers"


async def test_search_category_and_pages(client, hygraph):
    r = (await client.get("/api/blog/legacy", params={"q": "keywords"})).json()
    assert [p["slug"] for p in r["posts"]] == ["ats-keywords-guide"]
    assert "content" not in r["posts"][0]
    r = (await client.get("/api/blog/legacy", params={"category": "telugu-guides"})).json()
    assert [p["slug"] for p in r["posts"]] == ["telugu-guide"]
    r = (await client.get("/api/blog/legacy", params={"per_page": 2, "page": 2})).json()
    assert r["pages"] == 2 and [p["slug"] for p in r["posts"]] == ["telugu-guide"]
    assert {c["slug"] for c in r["categories"]} == {"resume-tips", "telugu-guides"}


async def test_many_posts_are_read_page_by_page_and_cached(client, hygraph):
    hygraph["posts"] = [post(f"post-{i}", f"Post number {i}") for i in range(250)]
    r = (await client.get("/api/blog/legacy", params={"per_page": 20})).json()
    assert r["total"] == 250 and r["pages"] == 13
    assert len(hygraph["calls"]) == 3  # 100 + 100 + 50
    await client.get("/api/blog/legacy")
    assert len(hygraph["calls"]) == 3  # served from memory


async def test_a_failure_keeps_the_last_good_copy(client, hygraph, monkeypatch):
    first = await all_posts(client)
    hygraph["fail"] = True
    monkeypatch.setattr(legacy.CACHE, "at", -1e9)  # pretend the copy is old
    again = await all_posts(client)
    assert again["error"] == "HTTP 401: not allowed"
    assert [p["slug"] for p in again["posts"]] == [p["slug"] for p in first["posts"]]
    assert TOKEN not in json.dumps(again)


async def test_first_load_failure_answers_empty(client, hygraph):
    hygraph["fail"] = True
    body = await all_posts(client)
    assert body["configured"] is True and body["posts"] == [] and body["error"].startswith("HTTP 401")


def test_markdown_to_ast():
    ast = markdown_to_ast(
        "## Title\n\nSome **bold** and _it_ and snake_case.\n\n1. one\n2. two\n   - nested\n\n> quote\n\n```\ncode\n```"
    )
    types = [n["type"] for n in ast["children"]]
    assert types == ["heading-two", "paragraph", "numbered-list", "block-quote", "code-block"]
    para = ast["children"][1]["children"]
    assert {"text": "bold", "bold": True} in para and {"text": "it", "italic": True} in para
    assert para[-1]["text"].endswith("snake_case.")
    assert ast["children"][2]["children"][1]["children"][1]["type"] == "bulleted-list"


def test_rebrand_rules():
    link = Linker(["known"])
    assert link.text("Team Asuraa and the Asuraa Team at www.asuraa.in, Asuraa's tips") == (
        "Team Nm7 and the Nm7 Team at nm7.si, Nm7's tips"
    )
    assert link.text("Try asuraa.ai or https://app.asuraa.ai/x") == "Try asuraa.ai or https://app.asuraa.ai/x"
    assert link.text("Asuraa in Hyderabad") == "Nm7 in Hyderabad"
    assert link.text("See https://asuraa.in/blog/known.") == "See https://nm7.si/blog/known."
    assert link.href("https://asuraa.in/blog/known?x=1") == "https://nm7.si/blog/known"
    assert link.href("https://asuraa.in") == "https://nm7.si"
    assert link.href("https://asuraa.in/blog") == "https://nm7.si/blog"
    assert link.href("https://example.org/a") == "https://example.org/a"
    assert link.href("#part") == "#part"
    assert norm_title("ATS Keywords Guide!") == norm_title("ats keywords guide")
    assert norm_title("What is Asuraa?") == norm_title("What is Nm7")
