# Nm7 API (backend)

FastAPI + PostgreSQL for nm7.si. The full plan and decisions are in [`PLAN.md`](PLAN.md).

## Run locally

You need Python 3.12+, [uv](https://docs.astral.sh/uv/) and PostgreSQL 16 (or Docker).

```bash
cd backend
cp .env.example .env            # fill in as needed
docker compose up -d db         # or use your own Postgres with databases nm7 and nm7_test
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload   # http://localhost:8000/health · docs at /docs
```

Everything in Docker: `docker compose up --build`.

## Tests and checks

```bash
uv run ruff check . && uv run ruff format --check .
uv run pytest            # uses TEST_DATABASE_URL (default: nm7_test on localhost)
```

Tests reset the test database to an empty schema and migrate it to the latest revision on every run.

## Database changes

```bash
uv run alembic revision --autogenerate -m "what changed"
uv run alembic upgrade head
```

New model modules must be imported in `app/models.py` so Alembic sees them. CI fails if the models and migrations drift (`alembic check`).

## Deploy (Render, Singapore)

`render.yaml` is a Render Blueprint for the API web service and its Postgres database.
In Render: **New → Blueprint**, pick the repo, set the Blueprint path to `backend/render.yaml`,
then fill in the secrets (ZeptoMail token, Razorpay keys). Migrations run on every start (`start.sh`).
Point `api.nm7.si` at the service with a CNAME record.
