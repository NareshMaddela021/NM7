# Nm7 backend plan

FastAPI + PostgreSQL API for nm7.si (AsuraaX AI). Phase 1 covers **accounts (sign-up / login), orders and Razorpay**.
The frontend in `../frontend` already has every screen; it talks to the server only through
`src/services/api.js` and `src/lib/auth.js`, so those two files (plus a few screens listed below) are what we connect.

## Decisions (14 Oct 2026)

| # | Topic | Decision |
|---|---|---|
| 1 | Customer / expert login | **Email + password** (sign-up asks to re-type the password), as the frontend has it. A **one-time 6-digit email code** verifies new accounts and resets passwords. **No SMS** for now (mobile OTP tab is removed; phone stays an optional, unverified contact field). |
| 1 | Admin login | Password + 6-digit **authenticator (TOTP)** code, "trust this device 30 days". |
| 2 | Email | **Zoho ZeptoMail** (transactional API). Needs SPF + DKIM records for nm7.si. |
| 3 | Hosting | **Render, Singapore**: web service (Docker) + Render Postgres. API at **api.nm7.si**. |
| 4 | Razorpay | No keys yet → build and test against **mocked Razorpay replies**; keys go in env vars later. |
| 5 | Invoices | Invoice number assigned **on payment success** (`NM7/26-27/0001`, per Indian financial year). GST PDF invoices later (GSTIN / SAC from the CA). |

## Stack

- Python 3.12+, **FastAPI**, Pydantic v2 + pydantic-settings
- **SQLAlchemy 2.0 async** + asyncpg, **Alembic** migrations
- **argon2** (argon2-cffi) for all passwords, **pyotp** for admin authenticator codes
- **httpx** for Razorpay and ZeptoMail (Razorpay's SDK is blocking)
- **pytest** + pytest-asyncio against a real Postgres; **respx** to mock Razorpay / ZeptoMail
- **uv** for dependencies (`uv.lock`), **ruff** for lint/format
- GitHub Actions: lint + migrations + tests on every push touching `backend/`

```
backend/
  app/
    main.py              app factory, CORS, routers, /health
    core/                config, db, security (hashing, tokens, cookies), email, rate_limit
    auth/                router · service · models · schemas
    orders/              router · service · models · pricing.py (server copy of frontend pricing.js)
    payments/            razorpay client · signature checks · webhook · refunds
    admin/               orders / payments / refunds endpoints, role checks
    cli.py               create-admin (prints authenticator URI + recovery codes)
  alembic/  tests/  pyproject.toml  uv.lock  Dockerfile  docker-compose.yml  .env.example
```

## Data model (money is always integer **paise**)

| Table | Key columns |
|---|---|
| `users` | id (uuid), email (citext, unique), name, phone?, role (customer/expert/admin), admin_role (owner/ops/finance/support/quality — same as `ROLES` in AdminContext.jsx), expert_status, password_hash, email_verified_at, totp_secret (encrypted, admins), terms_accepted_at, disabled_at, created_at |
| `email_codes` | user_id, purpose (verify_email / reset_password), code_hash, expires_at (10 min), attempts (max 5), used_at, ip |
| `sessions` | token_hash, user_id, two_step, expires_at, last_seen_at, ip, user_agent, revoked_at |
| `admin_login_challenges` | token_hash, user_id, expires_at (5 min), used_at — between admin step 1 and step 2 |
| `trusted_devices` | user_id, token_hash, expires_at (30 days) |
| `recovery_codes` | user_id, code_hash, used_at (10 per admin) |
| `orders` | id `RS-####` (Postgres sequence), customer_id, plan, target_role, status, amount, deadline_at, paid_at, invoice_no |
| `order_items` | order_id, kind (plan/addon/upgrade), code, amount |
| `invoice_counters` | financial_year (e.g. `26-27`), last_no — locked row per year |
| `payments` | order_id, razorpay_order_id (unique), razorpay_payment_id (unique), amount, status (created/captured/failed/refunded), method, raw (jsonb) |
| `refunds` | order_id, payment_id, razorpay_refund_id, amount, reason, details, status (review/approved/processed/rejected/failed), auto |
| `webhook_events` | razorpay event id (unique), type, payload, received_at, processed_at |
| `audit_log` | actor_id, action, target, data, at |

## Auth

Password rule (same as `passwordIssue` in auth.js): at least 8 characters, letters and at least one number.
All passwords hashed with argon2id. Codes are 6 digits, stored hashed, valid 10 minutes, 5 tries, one use.

**Customers & experts**
- `POST /api/auth/signup {role: customer|expert, name, email, phone?, password, password_confirm, terms_accepted}`
  → creates an **unverified** account and emails a code. The server also checks the two passwords match.
- `POST /api/auth/verify-email {email, code}` → marks the email verified and signs in.
- `POST /api/auth/verify-email/resend {email}` → always 200.
- `POST /api/auth/login {email, password}` → session cookie. Unverified email → `403 email_not_verified` (and a fresh code is sent). Admin accounts are refused here (they use /admin/login).
- `POST /api/auth/password/forgot {email}` → always 200 (no account enumeration); emails a code if the account exists.
- `POST /api/auth/password/reset {email, code, password, password_confirm}` → sets the password, **signs out every session**.
- `POST /api/auth/logout`, `GET /api/auth/me`.

**Admins**
- `POST /api/auth/admin/login {email, password}` → if a valid trusted-device cookie is present, signs in directly; otherwise returns a 5-minute challenge cookie.
- `POST /api/auth/admin/verify {code, trust}` → checks the TOTP code (±1 step, the same step can't be reused) or a recovery code; `trust` sets a 30-day trusted-device cookie.
- Admins are created only from the command line: `python -m app.cli create-admin` (prints the `otpauth://` URI / QR and 10 recovery codes). No public admin sign-up.

**Sessions & safety**
- Random token in an **httpOnly, Secure, SameSite=Lax** cookie on `.nm7.si`; only its hash is stored.
  Customers/experts: 30 days, sliding. Admins: 12 hours.
- Origin check on every state-changing request; CORS allows only `https://nm7.si` (+ localhost in dev).
- Rate limits: code sends 1/min and 5/hour per email; login 10 failures / 15 min per email and per IP.
- Route guards `require_user(role=…)` and `require_admin(perm="refunds")` mirror `ROLES` — the server enforces what the admin screens only hide.

## Orders & Razorpay

1. `POST /api/orders {planId, role, addons[]}` → server prices it from its own copy of the price list (never trusts a client amount),
   creates the order (`pending_payment`) and a Razorpay order (`receipt` = our order id), returns
   `{orderId, razorpayOrderId, amount, currency, keyId, prefill}`.
2. Frontend opens Razorpay Checkout (UPI / card / netbanking all inside Razorpay).
3. `POST /api/payments/verify {razorpay_order_id, razorpay_payment_id, razorpay_signature}` → HMAC-SHA256(`order_id|payment_id`, key secret),
   constant-time compare → order paid, 48 h deadline, status `offer`, invoice number, receipt email. Idempotent.
4. `POST /api/payments/webhook` → verifies `X-Razorpay-Signature` over the raw body (webhook secret); handles
   `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`; deduplicated by event id.
   Covers "paid but checkout closed early".
5. `GET /api/orders`, `GET /api/orders/{id}` (owner or admin).
6. `POST /api/orders/{id}/refund {reason, details}` — same rules as the frontend:
   late delivery or cancel before an expert accepts → automatic full refund via Razorpay; otherwise `review` →
   `POST /api/admin/refunds/{id}/approve|reject`.
7. Admin: `GET /api/admin/orders` (by deadline), `/api/admin/payments` (incl. payments without an order), `/api/admin/refunds`.
8. Status flow: `pending_payment → offer → in_progress → … → approved`; side exits `payment_failed`, `expired` (unpaid 24 h), `cancelled`, `refunded`.
   Expert stages are filled in during the expert phase.
9. Phase 1b: add-ons and upgrades as extra payments on an existing order (same create → verify flow).

While there are no Razorpay keys, the client talks to a base URL from settings and every test mocks Razorpay's replies with respx.
Signature checks are tested with known HMAC vectors.

## Frontend changes (milestone 6)

- `src/services/api.js`: real `fetch` for createOrder / pay / getOrder / requestRefund.
- `src/lib/auth.js`: call the API instead of browser storage.
- `src/pages/auth/Auth.jsx`: sign-up verifies the **email** code (instead of mobile); remove the "Mobile OTP" login tab; forgot-password uses the email code (already the shape).
- `src/pages/Checkout.jsx`: drop the custom UPI ID field (Razorpay handles it); the order id comes from the server.

## Environment variables

| Name | Notes |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://…` (Render gives `postgres://…` — converted automatically) |
| `SECRET_KEY` | long random string; signs/hashes tokens and codes |
| `ENCRYPTION_KEY` | Fernet key for TOTP secrets |
| `APP_ENV` | `dev` / `test` / `prod` |
| `CORS_ORIGINS` | `https://nm7.si` |
| `COOKIE_DOMAIN` | `.nm7.si` |
| `ZEPTOMAIL_TOKEN`, `EMAIL_FROM` | `noreply@nm7.si` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | empty until keys exist |

## Milestones (one commit each on the working branch)

1. ✅ **Skeleton** — app factory, settings, async DB, Alembic, docker-compose, `/health`, Dockerfile, CI.
2. ✅ **Customer & expert accounts** — sign-up, email verification code, login, logout, me, forgot/reset password, rate limits, ZeptoMail sender.
3. ✅ **Admin login** — password + TOTP, trusted devices, recovery codes, `create-admin`, role guards, audit log.
4. ✅ **Orders & Razorpay** — create, verify, webhook, invoice numbers (mocked Razorpay).
5. ✅ **Refunds & admin lists** — refund rules, approve/reject, admin orders / payments / refunds.
6. **Connect the frontend** — the screens listed above.

## As built — differences from the plan above

- Order status `payment_failed` is not used: a failed attempt marks the **payment** `failed` and the order stays
  `pending_payment`, so the customer can retry on the same Razorpay order.
- Refund ids are `RF-2001…`. Reasons: `late`, `cancel`, `quality`, `other`. `late` is refused (`not_late`) if the order
  isn't past its deadline; `cancel` is refused once an expert has started. Cancelled orders end as `cancelled`, others
  as `refunded`. `quality` / `other` need a short explanation.
- Admins may approve a **partial** amount; the order keeps going unless the full amount is refunded.
- One open refund per order (a rejected or failed one can be asked for again).
- The mobile number is stored as given (normalised) but **not unique** — it isn't verified, so uniqueness would let
  anyone block someone else's number.
- The checkout handler (`/verify`) doesn't know the payment method; the `payment.captured` webhook fills it in.
- Admins can't reset their password by email (only from the command line), so a stolen inbox can't take over an admin.
- Extra endpoints: `POST /api/auth/admin/forget-device`, `GET /api/admin/audit-log`.
