# Nm7 API (backend)

FastAPI + MongoDB (Atlas in production) for nm7.si. The full plan and decisions are in [`PLAN.md`](PLAN.md).

## Run locally

You need Python 3.12+, [uv](https://docs.astral.sh/uv/) and MongoDB 7/8 running as a **replica set**
(transactions need one; Atlas clusters always are). Easiest: Docker.

```bash
cd backend
cp .env.example .env            # fill in as needed
docker compose up -d db         # MongoDB 8.0, one-node replica set "rs0"
uv sync
uv run uvicorn app.main:app --reload   # http://localhost:8000/health · docs at /docs
```

With Docker the URI is `mongodb://127.0.0.1:27017/?directConnection=true`. Your own `mongod`: start it with
`--replSet rs0`, then once run `rs.initiate()` in `mongosh`; URI `mongodb://127.0.0.1:27017/?replicaSet=rs0`.

Everything in Docker: `docker compose up --build`.

## Tests and checks

```bash
uv run ruff check . && uv run ruff format --check .
uv run pytest            # TEST_MONGODB_URI (default: local replica set), database nm7_test
```

Tests drop and recreate the `nm7_test` database on every run (they refuse any database not ending in `_test`).

## Database

No migrations: each collection is described by a Pydantic model (`app/*/models.py`), and collections plus indexes
are created at start-up by `ensure_indexes` in `app/core/db.py` (safe to run every time). Add a field with a
default to the model; add an index to `INDEXES`. Unique rules live in indexes (email, order/invoice/refund numbers,
Razorpay ids, one open refund per order). Numbers (RS-1001…, NM7/26-27/0001…, RF-2001…) come from atomic counters
in the `counters` collection. Payments, refunds, admin set-up and admin creation use multi-document transactions.

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

`render.yaml` is a Render Blueprint for the API web service; the database is MongoDB Atlas (`MONGODB_URI`).
In Render: **New → Blueprint**, pick the repo, set the Blueprint path to `backend/render.yaml`,
then fill in the secrets (MongoDB URI, ZeptoMail token, Razorpay keys). Indexes are created on every start.
In Atlas → Network Access, allow `0.0.0.0/0` (Render's free plan has no fixed outgoing IP addresses).
Point `api.nm7.si` at the service with a CNAME record.

**Free-plan test deploy (current `render.yaml`):** the site is on Vercel (`frontend/vercel.json`, env
`VITE_API_BASE=https://nm7-api.onrender.com`) and the API on Render, so they are different sites: the API uses
`COOKIE_SAMESITE=none`, `CORS_ORIGINS=https://nm7.vercel.app`, and optionally `CORS_ORIGIN_REGEX` for Vercel
preview deployments (tie it to your own project and team slug — never all of `*.vercel.app`).
With `ZEPTOMAIL_TOKEN` and `RAZORPAY_*` empty the API still runs: emails are skipped (logged, without codes) and
ordering answers `payments_unavailable`.
The free web service has no Shell. Create the first owner on the website instead:
set `ADMIN_SETUP_TOKEN` (24+ random characters) on the API, open `/admin/setup` on the site, enter the token and the
owner's details, scan the QR code, save the recovery codes and confirm a 6-digit code. Setup closes for good once an
admin exists (404); then delete `ADMIN_SETUP_TOKEN`. Alternatively run `create-admin` from your computer with the
Atlas connection string: `MONGODB_URI='<atlas uri>' MONGODB_DB=nm7 uv run python -m app.cli create-admin …`.