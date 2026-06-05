#!/usr/bin/env bash
# RETIRED: this probe documented the original setMeta gap (only writing
# `name=`). The fix has shipped; coverage now lives in
# packages/web/tests/unit/lib/meta.test.ts. Do NOT run as part of verification.
#
# Probe D4: existing setMeta helper at packages/web/src/lib/meta.ts and its
# capability to emit <meta property="og:title">. The CURRENT helper only writes
# `name=` — confirmed gap to be fixed in the coder phase. We assert both:
#   (a) the helper exists,
#   (b) the current implementation does NOT support property=, and
# the verification stub for Stage 5 will assert (c) the FIXED helper does.
set -u
LOG="$(dirname "$0")/probe-meta.log"
HERE="$(cd "$(dirname "$0")/../../../.." && pwd)"
WEB="$HERE/packages/web"
PROBE_TEST="$WEB/tests/unit/_probe_meta.test.ts"
{
  echo "PROBE: meta/og:title"
  echo "TIME: $(date -u +%FT%TZ)"
  cat > "$PROBE_TEST" <<'EOF'
import { describe, it, expect } from "vitest";
import { setMeta } from "../../src/lib/meta";

describe("library-probe: setMeta og:title support", () => {
  it("setMeta exists as a function", () => {
    expect(typeof setMeta).toBe("function");
  });

  it("baseline: setMeta('og:title', X) is INVOKABLE without throwing", () => {
    expect(() => setMeta("og:title", "AI news - May 6, 2026")).not.toThrow();
  });

  it("baseline GAP: setMeta currently writes <meta name=...> NOT <meta property=...>", () => {
    document.head.innerHTML = "";
    setMeta("og:title", "test");
    const byName = document.head.querySelector('meta[name="og:title"]');
    const byProperty = document.head.querySelector('meta[property="og:title"]');
    // Documents the gap that the coder phase must fix:
    expect(byName).not.toBeNull();         // current behavior
    expect(byProperty).toBeNull();         // gap — needs coder fix
  });
});
EOF

  cd "$WEB"
  if pnpm vitest run --project unit tests/unit/_probe_meta.test.ts 2>&1; then
    echo "RESULT: VERIFIED (gap detected as expected)"
    rm -f "$PROBE_TEST"
    exit 0
  else
    rm -f "$PROBE_TEST"
    echo "RESULT: FAILED"
    exit 1
  fi
} | tee "$LOG"
