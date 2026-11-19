#!/bin/sh
# Starts the real API for the browser tests on a throwaway database (nm7_e2e), with emails written to the log.
set -e
cd "$(dirname "$0")/../../backend"
export APP_ENV=dev MONGODB_DB=nm7_e2e SECRET_KEY=e2e-only-secret ENCRYPTION_KEY= CORS_ORIGINS=http://localhost:5182 COOKIE_SAMESITE=lax \
  EMAIL_PROVIDER=resend RESEND_API_KEY= RAZORPAY_KEY_ID= RAZORPAY_KEY_SECRET= RAZORPAY_WEBHOOK_SECRET=e2e-webhook-secret ADMIN_SETUP_TOKEN=
export MONGODB_URI="${TEST_MONGODB_URI:-mongodb://127.0.0.1:27017/?replicaSet=rs0}"
uv run python -m tests.e2e_seed reset
# "Sign in with Google" test tokens: a key made now (the Google test signs with it); the client ID is accepted but kept
# out of the site flags, so no other test sees a Google button. Both are ignored when APP_ENV is prod.
export GOOGLE_TEST_CLIENT_ID=e2e-test.apps.googleusercontent.com
GOOGLE_TEST_JWKS="$(uv run python -m tests.e2e_google_key ../frontend/e2e-live/.google-key.json)"
export GOOGLE_TEST_JWKS
exec uv run uvicorn app.main:app --port 8001 > ../frontend/e2e-live/.api.log 2>&1
