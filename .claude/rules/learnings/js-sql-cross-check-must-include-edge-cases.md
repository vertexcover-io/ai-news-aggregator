# JS↔SQL cross-check tests are only as strong as their input matrix — must include edge cases

When you have two implementations of the *same* logic in two languages (a JS function and a Postgres `CASE` / `substring(... from '...')` expression that mirror each other), a "they return the same value" cross-check test is necessary but **not sufficient**. The test is only as good as the URLs you feed it. Pick only "canonical, happy-path" URLs and you will green-light two implementations that quietly disagree on every realistic edge case.

## What bit us

The `auto-sources-page` feature has a JS function `deriveRawItemIdentifier(item)` (e.g. extracts `r/LocalLLaMA` from `https://reddit.com/r/LocalLLaMA/comments/abc`) and a Postgres `CASE` expression that mirrors it for SQL aggregation. Phase 4 added a JS↔SQL cross-check test using one "canonical" URL per `SourceType` — and it passed.

Code review pass 2 found two latent bugs the cross-check missed:

1. **Backslash collapsing in JS template literals.** Writing `sql\`... '\.com'\`` in TypeScript sent `'.com'` (literal dot wildcard) to Postgres, not the intended `'\.com'` (escaped). Postgres POSIX regex treated `.` as "any character" — silently matched the wrong things. Fix: double-escape (`\\.` in the JS source so Postgres sees `\.`).
2. **POSIX regex is case-sensitive by default.** JS used `/i` flag everywhere; the Postgres regex did not. URLs like `https://X.com/karpathy/status/1` extracted `@karpathy` in JS but fell through to the hostname fallback in SQL. Fix: add `(?i)` inline flag to each Postgres regex.

Both bugs slipped the canonical-URL cross-check. Both would have been caught by an edge-case matrix.

## Rule

When writing a JS↔SQL alignment test (or any pair-of-implementations equivalence test), the input matrix MUST include at minimum:

1. **The canonical happy-path input** (well-formed URL with all expected parts).
2. **An uppercase variant** of the input (catches case-sensitivity divergence).
3. **A null / empty / missing input** (catches falsy-handling divergence).
4. **A malformed input** that the function is documented to fall through (catches fallback-chain divergence).
5. **An input with the regex's literal-dot characters in different positions** (`example.com.au`, `sub.domain.com`) — catches regex-escape divergence.
6. **Inputs with URL components that overlap with the regex's structural characters** (ports, query strings, fragments, paths starting with `/r/something/else` that aren't actually subreddit URLs).

Six tiers, eight `SourceType`s = ~48 inputs is the right ballpark — that's the level at which silent divergences surface. Three "looks-right-to-me" canonical URLs is the level at which they hide.

## Heuristic

If you're tempted to write a test of the form "for each enum value, pass one good example through both implementations and assert equality" — **stop**. Ask: what is the cheapest input that could differ between JS regex and POSIX regex? Add it. What is the cheapest input that could break in one but not the other when escapes collapse? Add it. The test should fail before the implementation is right, not after.

## Related

This is a variant of the more general "fuzz the boundary, not the center" testing principle. The boundary in cross-impl tests is the set of *transformations* the two implementations might disagree on (case folding, regex escapes, null vs empty, Unicode, encoding). Test the boundary, not the canonical center.
