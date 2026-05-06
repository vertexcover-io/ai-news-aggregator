#!/usr/bin/env bash
# Probe D5: anchor target=_blank + window.open in JSDOM.
# We don't actually navigate; we assert the DOM accepts the attributes and that
# window.open is callable. This documents the test mock pattern.
set -u
LOG="$(dirname "$0")/probe-anchor.log"
HERE="$(cd "$(dirname "$0")/../../../.." && pwd)"
WEB="$HERE/packages/web"
PROBE_TEST="$WEB/tests/unit/_probe_anchor.test.ts"
{
  echo "PROBE: anchor/window.open"
  echo "TIME: $(date -u +%FT%TZ)"
  cat > "$PROBE_TEST" <<'EOF'
import { describe, it, expect } from "vitest";

describe("library-probe: anchor target=_blank + window.open", () => {
  it("anchor element accepts target='_blank' and rel='noopener noreferrer'", () => {
    const a = document.createElement("a");
    a.href = "https://example.com";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
  });
  it("window.open is a callable function in JSDOM", () => {
    expect(typeof window.open).toBe("function");
  });
});
EOF

  cd "$WEB"
  if pnpm vitest run --project unit tests/unit/_probe_anchor.test.ts 2>&1; then
    echo "RESULT: VERIFIED"
    rm -f "$PROBE_TEST"
    exit 0
  else
    rm -f "$PROBE_TEST"
    echo "RESULT: FAILED"
    exit 1
  fi
} | tee "$LOG"
