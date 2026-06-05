#!/usr/bin/env bash
# Probe D3: Clipboard API + document.execCommand availability in JSDOM
# (the actual test environment of @newsletter/web).
# We write a temporary vitest test that asserts what's present/absent and run it.
set -u
LOG="$(dirname "$0")/probe-clipboard.log"
HERE="$(cd "$(dirname "$0")/../../../.." && pwd)"   # project root (worktree)
WEB="$HERE/packages/web"
PROBE_TEST="$WEB/tests/unit/_probe_clipboard.test.ts"
{
  echo "PROBE: clipboard"
  echo "TIME: $(date -u +%FT%TZ)"
  cat > "$PROBE_TEST" <<'EOF'
import { describe, it, expect } from "vitest";

// Probe: feature-detect Clipboard API + execCommand fallback in JSDOM.
// Documents what is available so the production code can branch correctly
// and so unit tests know which mocks to inject.
describe("library-probe: clipboard surfaces in JSDOM", () => {
  it("navigator exists", () => {
    expect(typeof navigator).toBe("object");
  });
  it("navigator.clipboard absence is informational only (mock in tests either way)", () => {
    const present = typeof (navigator as { clipboard?: unknown }).clipboard !== "undefined";
    // eslint-disable-next-line no-console
    console.log("[probe] navigator.clipboard present in JSDOM 29:", present);
    expect(typeof present).toBe("boolean");
  });
  it("document.execCommand is NOT present in JSDOM 29 — tests must inject mock", () => {
    // Real browsers still have execCommand. JSDOM 29 dropped it. Tests for the
    // fallback path must inject a stub via Object.defineProperty(document, ...).
    expect(typeof document.execCommand).toBe("undefined");
  });
});
EOF

  cd "$WEB"
  if pnpm vitest run --project unit tests/unit/_probe_clipboard.test.ts 2>&1; then
    echo "RESULT: VERIFIED"
    rm -f "$PROBE_TEST"
    exit 0
  else
    rm -f "$PROBE_TEST"
    echo "RESULT: FAILED"
    exit 1
  fi
} | tee "$LOG"
