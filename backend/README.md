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

## Admin accounts

Admins can't sign up on the website. Create them on the server (Render → Shell):

```bash
python -m app.cli create-admin --email admin@nm7.si --name "Naresh" --role owner   # owner/ops/finance/support/quality
python -m app.cli reset-admin-password --email admin@nm7.si
python -m app.cli reset-admin-2fa --email admin@nm7.si    # lost phone: new authenticator key + recovery codes
```

`create-admin` prints an `otpauth://` link (scan as a QR code or type the key) and 10 one-time recovery codes.

## Razorpay (when the keys arrive)

1. Razorpay Dashboard → Account & Settings → API keys: put the key id and secret in `RAZORPAY_KEY_ID` /
   `RAZORPAY_KEY_SECRET` (test keys `rzp_test_…` first, live keys later).
2. Payment capture: **automatic**.
3. Webhooks → add `https://api.nm7.si/api/payments/webhook` with a secret (→ `RAZORPAY_WEBHOOK_SECRET`) and the events
   `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.

Until the keys are set, ordering answers `503 payments_unavailable`. Tests never call Razorpay (replies are mocked).
Prices live in `app/orders/pricing.py` and must match `frontend/src/lib/pricing.js`.

## Scheduled job

Run `python -m app.cli expire-orders` every hour (Render Cron Job) so orders left unpaid for 24 hours show as expired.

## Deploy (Render, Singapore)

`render.yaml` is a Render Blueprint for the API web service and its Postgres database.
In Render: **New → Blueprint**, pick the repo, set the Blueprint path to `backend/render.yaml`,
then fill in the secrets (ZeptoMail token, Razorpay keys). Migrations run on every start (`start.sh`).
Point `api.nm7.si` at the service with a CNAME record.
