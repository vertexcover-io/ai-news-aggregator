#!/usr/bin/env bash
# Probe D2: X (twitter.com/intent/tweet) responds OK with text+url params.
# Twitter typically 302-redirects to login or to x.com; both are PASS for our purpose
# (the URL is well-formed; the user-agent will land on a composer or login).
set -u
LOG="$(dirname "$0")/probe-x.log"
TEXT='AI%20news%20-%20May%206%2C%202026'
URL='https%3A%2F%2Fexample.com%2Farchive%2Ftest'
TARGET="https://twitter.com/intent/tweet?text=${TEXT}&url=${URL}"
{
  echo "PROBE: x"
  echo "URL: $TARGET"
  echo "TIME: $(date -u +%FT%TZ)"
  # First check the unfollowed status (catches a hard 404 or 5xx)
  CODE_NO_FOLLOW=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 -A 'Mozilla/5.0 (orchestrate-probe)' "$TARGET" 2>&1)
  echo "HTTP_NO_FOLLOW: $CODE_NO_FOLLOW"
  # Then follow to terminal page
  CODE_FOLLOWED=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 -L -A 'Mozilla/5.0 (orchestrate-probe)' "$TARGET" 2>&1)
  echo "HTTP_FOLLOWED: $CODE_FOLLOWED"
  if [[ "$CODE_NO_FOLLOW" =~ ^(200|301|302|303|307|308)$ ]] && [[ "$CODE_FOLLOWED" =~ ^(200|301|302|303|307|308)$ ]]; then
    echo "RESULT: VERIFIED"
    exit 0
  fi
  echo "RESULT: FAILED (unexpected status)"
  exit 1
} | tee "$LOG"
