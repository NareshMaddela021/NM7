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
The browser tests in `frontend/e2e-live` start this API on a separate `nm7_e2e` database and seed it with
`tests/e2e_seed.py`.

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

## Email (Resend)

Transactional email goes through [Resend](https://resend.com) (`EMAIL_PROVIDER=resend`, the default); Zoho ZeptoMail
remains as an option (`EMAIL_PROVIDER=zeptomail` + `ZEPTOMAIL_TOKEN`).

- Verify the domain `nm7.si` in Resend (it shows the DNS records to add) and create an API key with
  **Sending access** limited to `nm7.si` → `RESEND_API_KEY`.
- Sender `EMAIL_FROM=Nm7 <no-reply@nm7.si>`, replies go to `EMAIL_REPLY_TO=info@nm7.si`.
- Failed sends are logged with the provider's status and message — never the subject or body (they contain codes).

## Razorpay (when the keys arrive)

1. Razorpay Dashboard → Account & Settings → API keys: put the key id and secret in `RAZORPAY_KEY_ID` /
   `RAZORPAY_KEY_SECRET` (test keys `rzp_test_…` first, live keys later).
2. Payment capture: **automatic**.
3. Webhooks → add `https://api.nm7.si/api/payments/webhook` with a secret (→ `RAZORPAY_WEBHOOK_SECRET`) and the events
   `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.

Until the keys are set, ordering answers `503 payments_unavailable`. Tests never call Razorpay (replies are mocked).
Prices live in `app/orders/pricing.py` and must match `frontend/src/lib/pricing.js`.

## Scheduled job

The API runs its automation rules every 10 minutes while it is awake (expire unpaid checkouts, take back offers an
expert didn't accept in time, email the support inbox about orders close to their deadline with no draft). Rules are
switched on/off and tuned in the admin console (Automation), which also has "Run now". On Render's free plan the API
sleeps when idle, so the rules run when the site is used. `python -m app.cli expire-orders` still works for a cron job.

## API map

| Area | Endpoints | Who |
|---|---|---|
| Accounts | `/api/auth/*` incl. `POST /password/change` (current + new + re-type; signs out other browsers) | anyone / signed in |
| Customer dashboard | `GET /api/me/state`, `/api/me/profile`, `/resumes`, `/cover-letters`, `/applications`, `/ats-checks`, `/share`, `/tickets`, `/referral` | that customer only (other ids → 404, other roles → 403) |
| Public | `GET /api/public/resumes/{slug}` (published resume, phone hidden on request, views counted), `GET /api/public/prices` | anyone |
| Orders | `/api/orders`, `/api/payments/*` | customer |
| Order work | `GET/PATCH /api/work/{order}` — intake, drafts, comments, chat, rating | the customer, the assigned expert, admins with "orders" |
| Experts | `GET/PUT /api/expert/profile`, `POST /profile/submit`, `POST /test` | expert |
| Admin | `/api/admin/stats`, `/orders` (+ `/{id}`, `/{id}/assign`), `/experts` (+ decision, pause), `/refunds`, `/payments`, `/invoices`, `/customers` (+ notes, block), `/tickets` (+ reply), `/quality`, `/reports` (+ `orders.csv`), `/settings`, `/automation`, `/team`, `/audit-log` | admins, by role (see `app/admin/roles.py`); every change is audit-logged |

Support tickets are emailed to `SUPPORT_INBOX` (default `info@nm7.si`) with the customer as reply-to.

## Deploy (Render, Singapore)

`render.yaml` is a Render Blueprint for the API web service; the database is MongoDB Atlas (`MONGODB_URI`).
In Render: **New → Blueprint**, pick the repo, set the Blueprint path to `backend/render.yaml`,
then fill in the secrets (MongoDB URI, Resend API key, Razorpay keys). Indexes are created on every start.
In Atlas → Network Access, allow `0.0.0.0/0` (Render's free plan has no fixed outgoing IP addresses).
Point `api.nm7.si` at the service with a CNAME record.

**Free-plan test deploy (current `render.yaml`):** the site is on Vercel (`frontend/vercel.json`, env
`VITE_API_BASE=https://nm7-api.onrender.com`) and the API on Render, so they are different sites: the API uses
`COOKIE_SAMESITE=none`, `CORS_ORIGINS=https://nm7.vercel.app`, and optionally `CORS_ORIGIN_REGEX` for Vercel
preview deployments (tie it to your own project and team slug — never all of `*.vercel.app`).
With `RESEND_API_KEY` and `RAZORPAY_*` empty the API still runs: sign-up, resend code and forgot password answer
503 "Email is temporarily unavailable" (and the log says which key is missing), and ordering answers `payments_unavailable`.
The free web service has no Shell. Create the first owner on the website instead:
set `ADMIN_SETUP_TOKEN` (24+ random characters) on the API, open `/admin/setup` on the site, enter the token and the
owner's details, scan the QR code, save the recovery codes and confirm a 6-digit code. Setup closes for good once an
admin exists (404); then delete `ADMIN_SETUP_TOKEN`. Alternatively run `create-admin` from your computer with the
Atlas connection string: `MONGODB_URI='<atlas uri>' MONGODB_DB=nm7 uv run python -m app.cli create-admin …`.
## Operations: errors, backups, keep-alive, staging, CI minutes

**Errors.** Every answer carries an `X-Request-Id`; an unexpected failure answers
`{"error": {"code": "server_error", "requestId": "…"}}` (JSON, with the CORS headers, so the site can show it) and the
log line for it starts with the same id. Set `SENTRY_DSN` (Render → nm7-api → Environment; a free Sentry project) and
the same failures are reported to Sentry with no personal data (`send_default_pii=False`, no bodies or cookies).
Without the variable nothing changes. The site does the same with `VITE_SENTRY_DSN` on Vercel (a separate Sentry
project of type "Browser JavaScript"); the Sentry client is loaded as its own file only when the variable is set.

**Backups** (`.github/workflows/backup.yml`). The free Atlas M0 tier keeps no backups, so a GitHub Actions job runs
`mongodump` every night at 02:01 IST and keeps an encrypted archive for 30 days (Actions → backup → the run →
Artifacts). It needs two repository secrets: `MONGODB_BACKUP_URI` (an Atlas database user with the built-in
*Only read any database* role, in a `mongodb+srv://…/nm7` string) and `BACKUP_PASSPHRASE` (a long random
passphrase, kept in a password manager). Until both are set the job only prints a warning. The restore commands are at
the top of the workflow file. Scheduled workflows run from the repository's **default branch**, so that branch must
carry the file.

**Keep-alive.** The free Render instance sleeps after 15 idle minutes. A GitHub Actions ping every 10 minutes
would cost about 3,000 Actions minutes a month on a private repository (each run bills a whole minute), so use a free
external monitor instead: cron-job.org or UptimeRobot, `GET https://nm7-api.onrender.com/health` every 10 minutes
(UptimeRobot also emails when the API is down).

**CI minutes** (private repository: 2,000 free minutes a month; each job bills whole minutes).
- `backend.yml` (~4 min) runs on pull requests that touch `backend/`; `frontend.yml` (~4 min) on pull requests that
  touch `frontend/`. One run per commit; a newer commit cancels the older run. Nothing re-runs after the merge.
- `e2e.yml` (~9 min, the browser suite against the real API + the CSP check) runs only on pull requests into the
  production branch, plus nightly and by hand.
- `deps.yml` (pip-audit, npm audit, Docker build) runs when dependency files or the Dockerfile change, and weekly.
- `deploy-check.yml` runs after a merge that changes `backend/` (~3–5 min while Render deploys).
- Scheduled workflows (nightly e2e, backup, Hygraph check, weekly deps) run from the repository's **default
  branch**: set it to `claude/fervent-albattani-wqmaoq` (Settings → General → Default branch), or they never run.

**Staging** (`render.yaml`, second service `nm7-api-staging`, database `nm7_staging` on the same cluster). Vercel
preview deployments talk to it instead of production, so a branch under review can never touch live data:

1. Render → Blueprints → the existing blueprint → *Sync*: it creates `nm7-api-staging`. Paste `MONGODB_URI` (the
   same cluster is fine), set `ENCRYPTION_KEY` to a new random value, leave the Razorpay and Anthropic keys empty
   unless staging needs them, set `RESEND_API_KEY` only for real emails from staging. Set `ADMIN_SETUP_TOKEN` once to
   create a staging owner at `<preview>/admin/setup`, then delete it.
2. Vercel → project nm7 → Settings → Environment Variables → `VITE_API_BASE`: keep the Production value
   (`https://nm7-api.onrender.com`) and add a **Preview**-scoped value `https://nm7-api-staging.onrender.com`.
   Redeploy one preview to pick it up.
3. Render → nm7-api → Environment: delete `CORS_ORIGIN_REGEX` (production no longer needs to accept preview origins).
   The staging service keeps the regex, and `CORS_ORIGINS` there names the `staging` branch preview if you use one.
4. Rollback: Render → nm7-api → Manual Deploy → *Deploy a specific commit* (paste the SHA), or re-run the
   deploy-check workflow by hand after the commit is back on the branch.

The automation pass (`app/automation.py`) takes a short lease in the `locks` collection before it runs, so a second
instance, or an admin's *Run now* during a scheduled pass, never emails twice.
