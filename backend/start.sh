#!/bin/sh
# Serve the API. Collections and indexes are created at start-up (idempotent). Render sets $PORT.
set -e
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips='*'
