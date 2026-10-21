#!/bin/sh
# Serve the API. Collections and indexes are created at start-up (idempotent). Render sets $PORT.
set -e
# --proxy-headers: Render's proxy sets X-Forwarded-Proto (the app reads X-Forwarded-For itself, see TRUSTED_PROXY_HOPS).
# --limit-concurrency: past 64 requests in flight the server answers 503 at once instead of queueing until it
# falls over (a 512 MB instance; long AI calls hold a slot each).
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips='*' \
  --limit-concurrency 64 --timeout-keep-alive 15
