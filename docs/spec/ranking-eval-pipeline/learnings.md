# Learnings — Ranking Eval Pipeline

Non-obvious takeaways from the 9-phase build.

## 1. Two agents collaborating on one file via a coordination protocol works

Phases 6 (grading UI) and 7 (manual-fixture builder UI) both needed to
extend `packages/web/src/api/eval.ts`. The orchestrator's dispatch had
the two agents write their own slice (`fetchFixture`/`saveGroundTruth`
vs `createManualFixture`/`listFixtures`) and an explicit "append-only,
named export, no top-level state" coordination rule. Merge was clean —
no conflicts, no double-imports, no shared mutable state.

**Takeaway:** parallel agent work on a single shared file is viable when
the file has well-named, side-effect-free exports and the prompts spell
out the contract. This is a counterpoint to the default assumption that
parallel agents must own disjoint files.

## 2. Review pass-1 missed the windowSize defect; pass-2 caught it by
   walking forward from the UI control

Pass-1 reviewed the new server route, the SSE handler, and the cost
estimator independently. Each was internally correct. Pass-2 started
from "what does the user click?" — the windowSize input on `EvalIndexPage`
— and walked forward into the network call, then the route handler,
then the runEval invocation. The defect: the UI passed `windowSize` but
the server handler dropped it on the floor (it was destructured into a
no-op variable). Fix landed in `b85c3df`.

This reinforces `.claude/rules/learnings/cache-vs-spec-promise-review.md`
(walk forward from the user-visible promise) and is now its second
real-world hit. Consider promoting "forward-walk review pass" to a
standing checklist item, not just a learning.

## 3. CLI dry-run as a free integration smoke test

The Phase 4 CLI exposes `--dry-run` which executes the full argv-parse →
fixture-load → window-slice → cost-estimate path WITHOUT hitting
Anthropic. This made `cli-smoke` a useful claim to actually run during
spec generation (it surfaced a `--prompt-file` path-resolution bug
early), and now serves as a single-command sanity probe that exercises
~80% of the CLI's surface for free.

**Takeaway:** if a feature has a paid external dependency, design the
CLI to have a `--dry-run` that runs everything else. It pays for itself
the first time spec generation catches a bug.

## 4. Mode B "draft equals saved" is a UX trap that wanted a dedicated test

REQ-032 documents the "draft byte-identical to saved" hint; the obvious
implementation is to disable Run. The non-obvious detail: a naive
`useState(initialPrompt)` + `<textarea>` round-trip introduces a trailing
newline difference (browsers may or may not preserve it). The fix was to
compare via `.trim()` on both sides, AND to add a unit test
(`EvalIndexPage.test.tsx "Mode B Run is disabled when draft equals
saved"`) that simulates `onChange` returning the saved value plus a `\n`
and asserts the button is still disabled.

**Takeaway:** any "equal to saved" UI hint needs to enumerate the
plausible whitespace/encoding drifts as test cases. Otherwise the hint
flickers in production.
