"""A person's own data is never kept by a shared cache or CDN; public answers are left alone."""

from tests.conftest import signup


async def test_personal_answers_are_private_and_never_stored(client, outbox):
    await signup(client, outbox)
    for path in ("/api/me/resumes", "/api/auth/me", "/api/me/state"):
        r = await client.get(path)
        assert r.status_code == 200, path
        assert r.headers["cache-control"] == "private, no-store", path
    signed_out = await client.post("/api/auth/logout")
    assert signed_out.headers.get("cache-control") == "private, no-store"


async def test_public_answers_keep_their_own_caching(client):
    r = await client.get("/api/public/prices")
    assert r.status_code == 200
    assert r.headers.get("cache-control") != "private, no-store"
