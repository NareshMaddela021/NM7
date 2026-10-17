"""Snap photos: POST /api/me/photo-import with the Claude call mocked. ID numbers never come back or get saved."""

import base64
import json
import re

import anthropic
import pytest

from app.core.config import get_settings
from app.photos import reader
from app.photos.scrub import looks_like_id, scrub
from tests.conftest import signup

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200  # only the first bytes are checked; the reader is mocked
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 200
HEIC = b"\x00\x00\x00\x18ftypheic" + b"\x00" * 200
FAKE_AADHAAR = "4821 7365 9012"  # a made-up number for the dummy Aadhaar fixture


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def photo(raw: bytes = JPEG, **kw):
    return {"name": "p.jpg", "data": b64(raw), **kw}


def field(value, conf="high", from_id=False):
    return {"value": value, "confidence": conf, "fromId": from_id}


def model_output(kind="handwritten_note", **personal):
    p = {k: field("") for k in ("name", "city", "state", "address", "dob", "gender", "guardian", "phone", "email")}
    p.update(personal)
    return {
        "photos": [{"index": 0, "kind": kind, "readable": True}],
        "personal": p,
        "headline": "Light Commercial Vehicle Driver",
        "experience": [
            {
                "role": "Driver",
                "company": "Sri Sai Transports",
                "from": "2020",
                "to": "Present",
                "lines": ["Drove light commercial vehicles for 4 years across Hyderabad with no accidents"],
                "confidence": "high",
            }
        ],
        "skills": [{"value": "LMV driving licence", "confidence": "high"}],
        "certifications": [],
        "education": [],
        "languages": [{"value": "Telugu", "confidence": "high"}, {"value": "Hindi", "confidence": "low"}],
    }


@pytest.fixture
def key_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")


@pytest.fixture
def model(monkeypatch):
    """Replaces the Claude call; `model.out` is what it returns, `model.calls` what it was sent."""

    class M:
        out = model_output()
        calls: list = []

    async def fake(images):
        M.calls.append(images)
        if isinstance(M.out, Exception):
            raise M.out
        return json.loads(json.dumps(M.out))

    M.calls = []
    monkeypatch.setattr(reader, "call_model", fake)
    return M


async def post(client, photos, **kw):
    return await client.post("/api/me/photo-import", json={"photos": photos, **kw})


# ---------- the scrubber ----------

ID_NUMBERS = [
    "4821 7365 9012",
    "482173659012",
    "4821-7365-9012",
    "XXXX XXXX 9012",
    "xxxxxxxx9012",
    "**** **** 9012",
    "9182 7364 5546 1029",  # VID
    "9182736455461029",
    "ABCPE1234F",  # PAN
    "abcpe1234f",
    "ABCPE 1234 F",
    "XYZ1234567",  # voter ID (EPIC)
    "TS09 20110012345",  # driving licence
    "MH-12-2011-0012345",
    "DL0420110149646",
    "TS0920110012345",
    "123456789012",  # bank account
    "00012345678901",
    "SBIN0001234",  # IFSC
    "Aadhaar No: 4821",
    "A/c no 5566",
]


@pytest.mark.parametrize("value", ID_NUMBERS)
def test_scrubber_finds_every_id_format(value):
    assert looks_like_id(value), value
    assert looks_like_id(f"My number is {value} ok"), value
    cleaned = scrub({"personal": {"address": field(f"H.No 4-12, {value}, Hyderabad")}, "skills": [{"value": value}]})
    assert cleaned["personal"]["address"]["value"] == ""
    assert cleaned["skills"] == []


@pytest.mark.parametrize(
    "value",
    [
        "Drove light commercial vehicles for 4 years across Hyderabad",
        "2019 - 2023",
        "2019-2023",
        "15/05/2003",
        "Salary ₹18,500 per month",
        "AC technician, 5 years",
        "H.No 4-12/3, Ameerpet, Hyderabad 500016",
        "LMV and HMV driving licence",
    ],
)
def test_scrubber_keeps_normal_text(value):
    assert not looks_like_id(value), value


def test_scrubber_keeps_a_phone_only_in_the_phone_field_and_drops_id_keys():
    out = scrub(
        {
            "personal": {"phone": field("98765 43210"), "address": field("Call 9876543210")},
            "aadhaar_number": "4821 7365 9012",
            "pan": "ABCPE1234F",
            "nested": {"accountNumber": "123", "ok": "fine"},
        }
    )
    assert out["personal"]["phone"]["value"] == "98765 43210"
    assert out["personal"]["address"]["value"] == ""
    assert "aadhaar_number" not in out and "pan" not in out and out["nested"] == {"ok": "fine"}
    assert scrub({"personal": {"phone": field("4821 7365 9012")}})["personal"]["phone"]["value"] == ""


# ---------- the endpoint ----------


async def test_feature_off_without_a_key(client, outbox, model):
    await signup(client, outbox)
    r = await post(client, [photo()])
    assert r.status_code == 503 and r.json()["error"]["code"] == "feature_off"
    assert "being switched on" in r.json()["error"]["message"]
    assert model.calls == []


async def test_only_signed_in_customers(client, outbox, make_client, key_on, model):
    assert (await post(client, [photo()])).status_code == 401
    expert = make_client()
    await signup(expert, outbox, "ex@example.com", role="expert", name="Ravi")
    assert (await post(expert, [photo()])).status_code == 403


async def test_reads_a_handwritten_note(client, outbox, key_on, model):
    await signup(client, outbox)
    model.out = model_output(name=field("Ramesh Kumar"), city=field("Hyderabad"), phone=field("98765 43210"))
    r = await post(client, [photo(), photo(PNG), photo(WEBP)])
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["personal"]["name"]["value"] == "Ramesh Kumar"
    assert d["experience"][0]["lines"][0].startswith("Drove light commercial vehicles")
    assert d["languages"][1] == {"value": "Hindi", "confidence": "low"}  # low confidence is kept and marked
    assert [t for t, _ in model.calls[0]] == ["image/jpeg", "image/png", "image/webp"]


async def test_telugu_note_comes_back_in_english(client, outbox, key_on, model):
    """The Telugu note itself is read by the model (mocked here); what comes back is English and scrubbed."""
    await signup(client, outbox)
    model.out = model_output(name=field("Venkatesh"), city=field("Warangal", "low"))
    model.out["experience"][0]["lines"] = ["Worked as a house wiring electrician for 6 years in Warangal"]
    r = await post(client, [photo()])
    assert r.json()["personal"]["city"] == {"value": "Warangal", "confidence": "low", "fromId": False}
    assert not re.search(r"[ఀ-౿]", r.text)  # no Telugu script in the reply


async def test_size_type_and_count_limits(client, outbox, key_on, model):
    await signup(client, outbox)
    big = b"\xff\xd8\xff" + b"\x00" * (10 * 1024 * 1024 + 10)
    r = await post(client, [photo(big)])
    assert r.status_code == 413 and r.json()["error"]["code"] == "photo_too_large"
    r = await post(client, [photo(b"%PDF-1.4 hello")])
    assert r.status_code == 415
    r = await post(client, [photo(HEIC)])
    assert r.status_code == 415 and "HEIC" in r.json()["error"]["message"]
    r = await post(client, [photo()] * 7)
    assert r.status_code == 400 and r.json()["error"]["code"] == "too_many_photos"
    r = await post(client, [])
    assert r.status_code == 400
    r = await client.post("/api/me/photo-import", json={"photos": [{"data": "not base64!!"}]})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_photo"
    assert model.calls == []


async def test_id_card_needs_consent(client, outbox, key_on, model):
    await signup(client, outbox)
    # marked by the customer: refused before anything is read
    r = await post(client, [photo(is_id=True)])
    assert r.status_code == 400 and r.json()["error"]["code"] == "consent_required"
    assert model.calls == []
    # not marked, but the reader sees an ID card: nothing from it comes back without consent
    model.out = model_output("id_card", name=field("Ramesh Kumar", from_id=True), dob=field("01/01/1990", from_id=True))
    r = await post(client, [photo()])
    assert r.status_code == 409 and r.json()["error"]["code"] == "id_consent_required"
    assert r.json()["error"]["photos"] == [0]
    assert "Ramesh" not in r.text and "1990" not in r.text
    r = await post(client, [photo()], idConsent=True)
    assert r.status_code == 200
    assert r.json()["personal"]["dob"]["fromId"] is True


async def test_dummy_aadhaar_number_never_appears_anywhere(client, outbox, key_on, model, db):
    await signup(client, outbox)
    spaced, joined = FAKE_AADHAAR, FAKE_AADHAAR.replace(" ", "")
    # a model that misbehaves and puts the number (and others) everywhere
    out = model_output(
        "id_card",
        name=field("Lakshmi Devi", from_id=True),
        address=field(f"D.No 3-4, Kukatpally, Hyderabad, Aadhaar {spaced}", from_id=True),
        dob=field("12/08/1988", from_id=True),
        gender=field("Female", from_id=True),
        guardian=field("W/O Suresh", from_id=True),
        email=field(joined),
        phone=field(spaced),
    )
    out["aadhaar"] = spaced
    out["vid"] = "9182 7364 5546 1029"
    out["experience"][0]["lines"].append(f"Aadhaar {joined}, VID 9182736455461029, PAN ABCPE1234F")
    out["skills"].append({"value": f"ID {spaced}", "confidence": "high"})
    out["certifications"].append(
        {"name": "Licence TS09 20110012345", "issuer": "RTA", "year": "2015", "confidence": "high"}
    )
    model.out = out
    r = await post(client, [photo(is_id=True)], idConsent=True)
    assert r.status_code == 200, r.text
    text = r.text
    for secret in (spaced, joined, "9012", "9182 7364 5546 1029", "9182736455461029", "ABCPE1234F", "20110012345"):
        assert secret not in text, secret
    d = r.json()
    assert d["personal"]["name"]["value"] == "Lakshmi Devi"  # the rest of the ID details survive
    assert d["personal"]["address"]["value"] == ""
    assert d["certifications"] == [] or all("Licence" not in c["name"] for c in d["certifications"])
    # nothing from the photos is stored anywhere (only the rate-limit counter)
    for name in await db.list_collection_names():
        async for doc in db[name].find({}):
            dumped = json.dumps(doc, default=str)
            assert joined not in dumped and spaced not in dumped, name
            assert "Lakshmi" not in dumped, name


async def test_blurry_photo_is_reported_not_silent(client, outbox, key_on, model):
    await signup(client, outbox)
    model.out = model_output()
    model.out["photos"] = [
        {"index": 0, "kind": "other", "readable": False},
        {"index": 1, "kind": "handwritten_note", "readable": True},
    ]
    r = await post(client, [photo(), photo()])
    assert r.json()["photos"] == [
        {"index": 0, "kind": "other", "readable": False},
        {"index": 1, "kind": "handwritten_note", "readable": True},
    ]
    model.out = reader.ReadFailed("bad_json")
    r = await post(client, [photo()])
    assert r.status_code == 422 and "better light" in r.json()["error"]["message"]


async def test_five_imports_a_day(client, outbox, key_on, model):
    await signup(client, outbox)
    for _ in range(5):
        assert (await post(client, [photo()])).status_code == 200
    r = await post(client, [photo()])
    assert r.status_code == 429
    assert "5 times a day" in r.json()["error"]["message"]
    assert len(model.calls) == 5


def reply(stop="end_turn", text=None, model="claude-haiku-5-5", thinking=False):
    content = [{"type": "thinking", "thinking": "", "signature": "sig"}] if thinking else []
    if text is not None:
        content.append({"type": "text", "text": text})
    return {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop,
        "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 10},
    }


GOOD = json.dumps(model_output())
EMPTY = json.dumps(
    {
        "photos": [{"index": 0, "kind": "other", "readable": False}],
        "personal": {k: {"value": "", "confidence": "low", "fromId": False} for k in ("name", "city")},
        "headline": "",
        "experience": [],
        "skills": [],
        "certifications": [],
        "education": [],
        "languages": [],
    }
)


@pytest.fixture
def api(monkeypatch):
    """The real reader with Anthropic's HTTP API mocked. `api.replies` per model: a reply dict, an int (HTTP
    status) or an exception; `api.sent` the requests."""
    import httpx2

    monkeypatch.setattr(get_settings(), "anthropic_api_key", "sk-test")
    monkeypatch.setattr(get_settings(), "anthropic_model", "claude-haiku-5-5")

    class A:
        replies: dict = {}
        sent: list = []

        @staticmethod
        def bodies():
            return [json.loads(r.content) for r in A.sent]

    def handler(request):
        A.sent.append(request)
        r = A.replies[json.loads(request.content)["model"]]
        if isinstance(r, Exception):
            raise r
        if isinstance(r, int):
            return httpx2.Response(r, json={"type": "error", "error": {"type": "x", "message": "no"}})
        if isinstance(r, tuple):  # (status, error body, headers)
            return httpx2.Response(r[0], json=r[1], headers=r[2])
        return httpx2.Response(200, json=r)

    A.sent = []
    monkeypatch.setattr(reader, "HTTP_CLIENT", httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))
    return A


async def test_reader_on_haiku_sends_images_strict_json_and_no_fallback_param(api):
    """Claude Haiku 5.5: image blocks, the JSON schema, effort medium - and no `fallbacks` (Haiku has none)."""
    api.replies = {"claude-haiku-5-5": reply(text=GOOD, thinking=True)}  # the answer after a thinking block
    out = await reader.call_model([("image/jpeg", b64(JPEG)), ("image/png", b64(PNG))])
    assert out["headline"] == "Light Commercial Vehicle Driver"
    assert len(api.sent) == 1
    req = api.sent[0]
    assert str(req.url).startswith("https://api.anthropic.com/v1/messages")
    assert "server-side-fallback" not in req.headers.get("anthropic-beta", "")
    body = json.loads(req.content)
    assert body["model"] == "claude-haiku-5-5" and "fallbacks" not in body
    assert body["max_tokens"] == 16000 and "temperature" not in body and "thinking" not in body
    assert body["output_config"]["effort"] == "medium"
    images = [c for c in body["messages"][0]["content"] if c["type"] == "image"]
    assert [i["source"]["media_type"] for i in images] == ["image/jpeg", "image/png"]
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert body["output_config"]["format"]["schema"]["additionalProperties"] is False
    prompt = body["messages"][0]["content"][-1]["text"]
    assert "NEVER output any identity or account number" in prompt and "answer ONLY in English" in prompt
    assert req.headers["x-api-key"] == "sk-test"


@pytest.mark.parametrize(
    "haiku",
    [reply("refusal"), reply(text=EMPTY), reply(text="not json"), reply(text='{"photos": "x"}'), reply("max_tokens")],
    ids=["refused", "empty", "bad_json", "invalid", "cut_off"],
)
async def test_unusable_haiku_answer_is_read_again_once_on_sonnet(api, haiku, caplog):
    api.replies = {"claude-haiku-5-5": haiku, "claude-sonnet-5-5": reply(text=GOOD, model="claude-sonnet-5-5")}
    out = await reader.call_model([("image/jpeg", b64(JPEG))])
    assert out["headline"] == "Light Commercial Vehicle Driver"
    assert [b["model"] for b in api.bodies()] == ["claude-haiku-5-5", "claude-sonnet-5-5"]
    sonnet = api.bodies()[1]
    assert sonnet["fallbacks"] == "default"  # Sonnet 5.5 takes the server-side refusal fallback
    assert "server-side-fallback-2026-07-01" in api.sent[1].headers["anthropic-beta"]
    assert "trying claude-sonnet-5-5" in caplog.text


async def test_both_models_unusable_is_one_read_failure(api, caplog):
    api.replies = {"claude-haiku-5-5": reply(text="nope"), "claude-sonnet-5-5": reply("refusal")}
    with pytest.raises(reader.ReadFailed) as e:
        await reader.call_model([("image/jpeg", b64(JPEG))])
    assert e.value.reason == "refused" and len(api.sent) == 2
    assert "bad_json on claude-haiku-5-5" in caplog.text and "refused on claude-sonnet-5-5" in caplog.text


async def test_sonnet_configured_is_not_read_twice(api, monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_model", "claude-sonnet-5-5")
    api.replies = {"claude-sonnet-5-5": reply("refusal")}
    with pytest.raises(reader.ReadFailed):
        await reader.call_model([("image/jpeg", b64(JPEG))])
    assert len(api.sent) == 1


async def test_wrong_key_is_logged_as_auth_error_without_the_key_or_content(api, caplog):
    api.replies = {"claude-haiku-5-5": 401}
    with pytest.raises(anthropic.AuthenticationError):
        await reader.call_model([("image/jpeg", b64(JPEG))])
    assert len(api.sent) == 1  # not retried, and no second model for an API error
    assert "photo reader: auth_error on claude-haiku-5-5" in caplog.text
    assert "sk-test" not in caplog.text and "NEVER output" not in caplog.text and b64(JPEG) not in caplog.text


@pytest.mark.parametrize(("status", "kind"), [(429, "rate_limited"), (400, "bad_request"), (529, "api_error_529")])
async def test_api_errors_are_logged_by_type(api, caplog, status, kind):
    api.replies = {"claude-haiku-5-5": status}
    with pytest.raises(anthropic.APIError):
        await reader.call_model([("image/jpeg", b64(JPEG))])
    assert f"photo reader: {kind} on claude-haiku-5-5" in caplog.text


async def test_timeout_is_75_seconds_with_one_retry(api, caplog):
    import httpx2

    assert 60 <= reader.TIMEOUT <= 90 and reader.RETRIES == 1
    api.replies = {"claude-haiku-5-5": httpx2.ReadTimeout("slow")}
    with pytest.raises(anthropic.APITimeoutError):
        await reader.call_model([("image/jpeg", b64(JPEG))])
    assert len(api.sent) == 2  # the first try and one retry
    assert "photo reader: timeout on claude-haiku-5-5" in caplog.text


async def test_fallback_read_counts_as_one_of_the_five(client, outbox, api, db):
    await signup(client, outbox)
    api.replies = {
        "claude-haiku-5-5": reply("refusal"),
        "claude-sonnet-5-5": reply(text=GOOD, model="claude-sonnet-5-5"),
    }
    r = await post(client, [photo()])
    assert r.status_code == 200 and r.json()["headline"] == "Light Commercial Vehicle Driver"
    assert len(api.sent) == 2
    assert await db["rate_events"].count_documents({"key": {"$regex": "^photo-import:"}}) == 1


async def test_wrong_key_tells_the_customer_to_try_later(client, outbox, api):
    await signup(client, outbox)
    api.replies = {"claude-haiku-5-5": 401}
    r = await post(client, [photo()])
    assert r.status_code == 502 and r.json()["error"]["code"] == "reader_unavailable"


async def test_a_400_logs_anthropics_error_type_message_and_request_id(api, caplog):
    """e.g. "credit balance too low" is a 400 invalid_request_error: the log line must say so."""
    body = {
        "type": "error",
        "error": {
            "type": "invalid_request_error",
            "message": "Your credit balance is too low to access the Anthropic API. Key sk-ant-api03-SECRETxyz "
            + "A" * 120,
        },
        "request_id": "req_body_1",
    }
    api.replies = {"claude-haiku-5-5": (400, body, {"request-id": "req_011CSHoEeqs5C35K2UUqR7Fy"})}
    with pytest.raises(anthropic.BadRequestError):
        await reader.call_model([("image/jpeg", b64(JPEG))])
    line = next(r.getMessage() for r in caplog.records if "photo reader:" in r.getMessage())
    assert line.startswith("photo reader: bad_request on claude-haiku-5-5 (type=invalid_request_error")
    assert "request_id=req_011CSHoEeqs5C35K2UUqR7Fy" in line
    assert "Your credit balance is too low" in line
    assert "sk-ant" not in line and "SECRET" not in line and "A" * 80 not in line and "[key]" in line
    assert "sk-test" not in caplog.text and b64(JPEG) not in caplog.text


DOCUMENTED_TOP = {"model", "max_tokens", "messages", "output_config"}  # what we send; all are Messages API fields
UNSUPPORTED_ON_HAIKU_5_5 = {"temperature", "top_p", "top_k", "fallbacks", "thinking"}  # 400s or not offered
UNSUPPORTED_SCHEMA_KEYS = {"minimum", "maximum", "multipleOf", "minLength", "maxLength", "pattern", "format", "$ref"}


def _check_schema(node, path="schema"):
    """Structured outputs' documented limits: additionalProperties false on every object, no optional or union
    parameters (we use none), no numeric/string constraints, enums of plain strings, minItems only 0 or 1."""
    assert not (UNSUPPORTED_SCHEMA_KEYS & set(node)), path
    assert "anyOf" not in node and not isinstance(node.get("type"), list), path
    if "enum" in node:
        assert all(isinstance(v, str) for v in node["enum"]), path
    assert node.get("minItems", 0) in (0, 1), path
    if node.get("type") == "object":
        assert node.get("additionalProperties") is False, path
        assert set(node.get("required", [])) == set(node["properties"]), f"{path}: optional parameters"
        for k, v in node["properties"].items():
            _check_schema(v, f"{path}.{k}")
    if node.get("type") == "array":
        _check_schema(node["items"], f"{path}[]")


async def test_haiku_request_has_only_haiku_supported_fields(api):
    api.replies = {"claude-haiku-5-5": reply(text=GOOD)}
    await reader.call_model([("image/jpeg", b64(JPEG))] * 6)  # the most photos a customer can send
    req = api.sent[0]
    body = json.loads(req.content)
    assert set(body) == DOCUMENTED_TOP
    assert not (UNSUPPORTED_ON_HAIKU_5_5 & set(body))
    assert "anthropic-beta" not in req.headers  # no beta features on Haiku
    assert body["model"] == "claude-haiku-5-5"
    assert 1 <= body["max_tokens"] <= 16000  # non-streaming: keep under the SDK's timeout guard (Haiku allows 128K)
    assert set(body["output_config"]) == {"effort", "format"}
    assert body["output_config"]["effort"] in {"low", "medium", "high"}  # thinking stays adaptive (the default)
    fmt = body["output_config"]["format"]
    assert set(fmt) == {"type", "schema"} and fmt["type"] == "json_schema"
    _check_schema(fmt["schema"])
    [msg] = body["messages"]
    assert msg["role"] == "user"  # ends on a user turn: no prefill
    for block in msg["content"]:
        assert block["type"] in {"text", "image"} and "cache_control" not in block
        if block["type"] == "image":
            src = block["source"]
            assert set(src) == {"type", "media_type", "data"} and src["type"] == "base64"
            assert src["media_type"] in {"image/jpeg", "image/png", "image/gif", "image/webp"}
            assert len(src["data"]) <= 10 * 1024 * 1024  # 10 MB base64 per image on the Claude API
    assert len(req.content) < 32 * 1024 * 1024  # Messages API request limit
