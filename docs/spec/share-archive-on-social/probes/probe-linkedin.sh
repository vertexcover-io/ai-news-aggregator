#!/usr/bin/env bash
# Probe D1: LinkedIn share-offsite intent URL responds OK with a `url` param.
# We send a HEAD with a real test URL and accept any 2xx/3xx as PASS.
# Failure modes detected: 404 (endpoint moved), DNS/network down, 5xx.
set -u
LOG="$(dirname "$0")/probe-linkedin.log"
TARGET='https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fexample.com%2Farchive%2Ftest'
{
  echo "PROBE: linkedin"
  echo "URL: $TARGET"
  echo "TIME: $(date -u +%FT%TZ)"
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 -L -A 'Mozilla/5.0 (orchestrate-probe)' "$TARGET" 2>&1)
  echo "HTTP: $CODE"
  if [[ "$CODE" =~ ^(200|301|302|303|307|308)$ ]]; then
    echo "RESULT: VERIFIED"
    exit 0
  fi
  echo "RESULT: FAILED (unexpected status)"
  exit 1
} | tee "$LOG"
