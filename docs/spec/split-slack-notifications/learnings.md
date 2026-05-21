# Learnings — split-slack-notifications

## L1 — Code review must verify the map-key matches the value being classified

### What bit us

`packages/pipeline/src/workers/email-send.ts` had this pattern:

```ts
const rawMessage = err instanceof Error ? err.message : String(err);
const reason = classifyDeliveryFailure(rawMessage);  // computes short label
failureReasonCounts.set(
  rawMessage,                                         // BUG: keying by raw, not classified
  (failureReasonCounts.get(rawMessage) ?? 0) + 1,
);
```

`classifyDeliveryFailure(rawMessage)` returns a concise label like `"rate limit"`,
`"recipient rejected"`, `"network timeout"`, or a truncated fallback. The
`reason` variable was computed, logged, then **discarded** for the
accumulation step — which kept the long raw provider error as the map key.

Result: the `failureReasons` array (which the Slack message renders as
`◦ N× <reason>` bullets) carried raw provider strings instead of the
intended short categorical labels. Each unique raw string counted as a
separate "reason," so the "top-3 reasons" logic returned 3 long, mostly
identical provider strings rather than the 1-2 short categories an
operator can scan.

Pass-1 code review didn't catch this because it focused on:
- The new split's correctness (notifyEmailDelivery vs combined message).
- Idempotency and dry-run paths.
- Diff against the spec's REQs.

It walked the call graph from the **plan's promises** but didn't read
the pre-existing accumulator logic carefully — the reasoning was "the
delivery payload shape is unchanged, so the classification logic is
out of scope."

Pass-2 caught it by re-reading every line of `email-send.ts`, including
the parts the diff didn't touch.

### Rule

When code review encounters a "value computed but immediately consumed by
a `Map.set` / `Map.get` chain", explicitly verify:

1. The **key** passed to `set` is the same variable as (or a deliberate
   derivation of) the **classified** form, not the **raw** input.
2. The downstream consumer of the map (display, aggregation, top-N
   reduction) is keyed by the intended bucket, not by accidental
   uniqueness.

This is a particularly silent class of bug because:
- The code compiles cleanly.
- Tests on the happy path (single failure, single reason) pass — the
  bucket is correct.
- Only multi-failure tests with **multiple different raw messages
  classifying to the same category** would catch it. The existing email-send
  test suite happened not to have such a fixture.

### Heuristic for future reviews

Whenever you see `classify(...)` + `count.set(...)` in the same block,
ask: "if I had ten different raw inputs that all classify to the same
label, would the count be 10 under the label, or 1 each under ten
different raw strings?" If the latter, you've found this bug.

## L2 — Backend-only PRs blow up the orchestrate quality-gate's Check 3 and Check 7

### What bit us

This PR was a textbook scope: backend, monorepo packages `shared` and
`pipeline` only, no UI, no API routes, no migrations. Yet the project's
quality-gate skill marked verdict **BLOCKED**:

- **Check 3** (Unit + Seam Tests): web Playwright e2e needs the dev
  server running; the skill's Service Lifecycle starts services BEFORE
  Check 8, not before Check 3 — so the gate guarantees BLOCKED on Check
  3 for any backend-only PR. Independently, one legacy seam test on
  `main` fails for reasons unrelated to this branch.
- **Check 7** (Ignore Comment Audit): one `eslint-disable-next-line`
  added in dead-code legacy worker, explicitly authorized by the plan.
  Strict zero-tolerance rule reads BLOCKED; the audit doesn't have
  "added vs pre-existing" distinction or "plan-authorized" carve-out.

The operator had to manually override "continue" past the BLOCKED
verdict, because the strict gate text doesn't allow for legitimate
exceptions like:
- Pre-existing failures on `main` that this PR did not touch.
- Plan-authorized line-scoped suppressions with documented reason text.

### Rule (for orchestrate skill authors / quality-gate authors)

When designing a quality gate that gets run repeatedly across many PRs:

1. **Compute deltas against the base branch**, not absolute counts. A
   gate that fires on the absolute count of `eslint-disable` comments in
   the repo will block every backend PR forever once the count is >0.
2. **Service lifecycle should be conditional on the check needing it.**
   If Check 3 e2e needs services, start them for Check 3, not Check 8.
   Or, mark Check 3's seam-test portion as `requires-services` and
   gracefully skip with a NOT_APPLICABLE when services aren't available
   (with an opt-in flag for "start services for full gate run").
3. **Allow plan-authorized exceptions to surface as PASS with a NOTE**
   rather than BLOCKED. Plan authorship is a higher-trust signal than
   ad-hoc disables; the gate should respect it.

### Heuristic for future feature pipelines

If your PR is backend-only, expect the project-local quality-gate to
flag Check 3 (no dev server) and possibly Check 7 (any new ignore
comment). The verdict will be BLOCKED but the substance will be
"infrastructure / pre-existing." Be ready to:

- Pre-compute the `git diff main..HEAD -- <failing files>` to prove
  delta is empty.
- Document any new `eslint-disable` with a `-- <reason>` annotation
  matching the plan text verbatim.
- Surface the BLOCKED-with-context to the operator for the override
  call rather than treating it as a hard stop.

This was the right call this time; codifying it as a pattern keeps
future backend-only feature pipelines from stalling here.

## L3 — `notifyWithMarker` is the right idempotency primitive; bespoke flows are justified only when a skip-precondition needs the loaded archive

### What we did

The four new notifier methods divided into two camps:

- `notifyEmailDelivery`, `notifyLinkedinPosted`, `notifyTwitterPosted` —
  reuse the existing `notifyWithMarker` helper unchanged. The `blocks`
  factory receives the loaded archive and renders.
- `notifySourceDistribution` — uses a bespoke flow because the skip
  condition (`archive.sourceTelemetry === null`) needs to read the
  archive **before** deciding whether to log "skipped no_telemetry" or
  proceed. Adding a `skipPredicate` parameter to `notifyWithMarker`
  would have been a speculative abstraction (one current call site).

The pass-1 review flagged this as a suggestion ("did you consider
delegating to notifyWithMarker?") but accepted the divergence.

### Rule

Don't generalize a helper for a one-call-site special case. Three
similar lines of duplicated guard logic is cleaner than parameterizing
the helper. If a second call site emerges that needs the same
skip-predicate pattern, then refactor with two real call sites in front
of you.

This matches the project's `.claude/rules/code-quality.md` "no premature
abstractions" rule — but the temptation in mid-implementation is to
"unify" because the bespoke flow feels duplicative. The right test is:
do we have ≥2 real call sites needing the abstraction, or just ≥1 plus
"it might happen later"? If the latter, leave the duplication.
