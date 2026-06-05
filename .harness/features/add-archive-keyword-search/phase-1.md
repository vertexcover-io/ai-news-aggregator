# Phase 1: Shared serializer

> **Status:** pending

## Overview

Add a pure function `serializeArchiveSearchText` in `@newsletter/shared` that takes (digestHeadline, digestSummary, rankedItems, rawItemsById) and returns a single string blob containing all override-aware searchable content for an archive. Pure, framework-free, fully unit-tested. Both API write paths and the pipeline AUTO_REVIEW path will call it in Phase 3.

## Implementation

**Files:**
- Create: `packages/shared/src/services/archive-search-text.ts`
- Modify: `packages/shared/src/index.ts` — add `export * from "./services/archive-search-text.js";`
- Test: `packages/shared/tests/unit/archive-search-text.test.ts`

**Pattern to follow:** `packages/api/src/services/rank-hydration.ts` (pure function shape; override-precedence logic). Replicate the precedence: `RankedItemRef.<field>` → `raw_items.metadata.recap.<field>` → empty.

**What to test:**
- Empty archive (`rankedItems: []`) → returns just the digest text (or empty string when both digest fields null).
- Override precedence: when `RankedItemRef.summary === 'OVERRIDE'` and `recap.summary === 'ORIGINAL'`, output contains `OVERRIDE` and not `ORIGINAL`.
- Bullets join: arrays of strings joined with `\n`; missing bullets render as nothing.
- Per-story fields included: title, url-host (e.g. `news.ycombinator.com`), `sourceType`, `author`, summary, bullets, bottomLine.
- Null digest fields tolerated (pre-VER-96 archives).
- 100 KB bottom-line input → output truncated to ≤ 64 KB total without throwing (EDGE-012).
- Story whose `rawItemsById` lookup misses → silently skipped (defensive at boundary; pipeline can race).

**Traces to:** REQ-008, REQ-010, EDGE-004, EDGE-005, EDGE-012.

**Algorithm (non-obvious bit):**

```ts
import type { RankedItemRef, RawItemRow } from "../types/index.js";

export interface ArchiveSearchInput {
  digestHeadline: string | null;
  digestSummary: string | null;
  rankedItems: RankedItemRef[];
  rawItemsById: Map<number, RawItemRow>;
}

const MAX_TEXT_BYTES = 64 * 1024;

export function serializeArchiveSearchText(input: ArchiveSearchInput): string {
  const parts: string[] = [];
  if (input.digestHeadline) parts.push(input.digestHeadline);
  if (input.digestSummary) parts.push(input.digestSummary);

  for (const ref of input.rankedItems) {
    const raw = input.rawItemsById.get(ref.rawItemId);
    if (!raw) continue;
    const recap = raw.metadata?.recap;
    const summary = ref.summary ?? recap?.summary ?? "";
    const bullets = (ref.bullets ?? recap?.bullets ?? []).join("\n");
    const bottomLine = ref.bottomLine ?? recap?.bottomLine ?? "";
    const host = safeHost(raw.url);
    parts.push(
      [raw.title, host, raw.sourceType, raw.author ?? "", summary, bullets, bottomLine]
        .filter(Boolean)
        .join("\n"),
    );
  }
  const out = parts.join("\n\n");
  // Truncate by byte length, not chars — multi-byte safety:
  if (Buffer.byteLength(out, "utf8") <= MAX_TEXT_BYTES) return out;
  return Buffer.from(out, "utf8").subarray(0, MAX_TEXT_BYTES).toString("utf8");
}

function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return ""; }
}
```

The truncation logic uses `Buffer.byteLength` because Postgres counts bytes, not chars. The trailing slice may produce a partial UTF-8 sequence — that's fine; FTS just won't index a malformed last token.

**Done when:**
- [ ] Function exported from `@newsletter/shared`
- [ ] Unit tests cover all listed scenarios; all green
- [ ] `pnpm typecheck` passes
- [ ] No new ESLint violations

**Commit:** `feat(VER-XX): add serializeArchiveSearchText helper`
