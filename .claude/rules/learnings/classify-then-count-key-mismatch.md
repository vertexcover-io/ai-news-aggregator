# `classify(x)` then `count.set(x, ...)` is almost always a key-mismatch bug

When you see the pattern `const label = classify(raw); map.set(raw, ...)` —
where the classified value is computed but the raw value is used as the
map key — the classification result is silently discarded and the map
buckets by raw uniqueness instead of category.

## What bit us

`packages/pipeline/src/workers/email-send.ts` (pre-existing on main,
caught during split-slack-notifications code review pass-2):

```ts
const reason = classifyDeliveryFailure(rawMessage);  // -> "rate limit"
failureReasonCounts.set(
  rawMessage,                                         // BUG: keying by raw
  (failureReasonCounts.get(rawMessage) ?? 0) + 1,
);
```

The downstream Slack "top-3 failure reasons" rendered raw provider error
strings instead of concise classified labels. Operator sees three
near-identical 200-character provider error messages instead of "rate
limit: 12" and "recipient rejected: 3".

## Rule

When reviewing or writing code that:
1. Computes a classified / categorized / bucketed form of an input
   (`classify`, `categorize`, `bucket`, `truncate`, `normalize`).
2. Inserts the input into a `Map` / `Set` / object literal.

Verify the **classified form** is the map key, not the raw input.

The bug is silent because:
- It type-checks (both raw and classified are usually `string`).
- Single-failure tests pass — one bucket either way.
- Only multi-input tests with **multiple distinct raw inputs classifying
  to the same label** would catch the mismatch.

## Heuristic

When you spot a `classify(x)` immediately followed by a `map.set(...)`
in the same block, run the mental test: "If I had ten different raw
inputs that all classify to the same label, would the map contain one
entry with count=10, or ten entries with count=1?"

If the latter, you've found the bug.

## Related

This is a variant of the more general "computed but unused" code smell.
The TypeScript compiler will not flag it because the classified value
IS used (in a log line, in a thrown exception) — just not where it
should be used (the map key).
