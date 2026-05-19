# Cross-phase type alignment: define shared types in Phase 1, use them in Phase 1's tests

When a multi-phase implementation introduces shared types in Phase 1 (e.g. `RunCostBreakdown`, `StageCost`) that downstream phases consume, the Phase 1 tests must exercise the shape *as the downstream phases will use it* — otherwise type drift slips through and Phase 2/3 has to fix it mid-flight.

## What bit us

In the admin-pipeline-cost-analysis spec, Phase 1 defined `StageCost` with a single `cacheCreationTokens` field. Phase 2 (cost tracker wiring) needed to compute cost from the two distinct Anthropic ephemeral cache tiers (5-minute vs 1-hour writes priced differently), so Phase 1's type was wrong and had to be widened mid-implementation to `cacheCreation5mTokens` + `cacheCreation1hTokens`.

The Phase 1 unit tests only asserted that the fields existed, not that they matched the live SDK + pricing-table shape. The library-probe captured the SDK shape correctly, but spec-generation collapsed the two cache-creation tiers into one field.

## Rule

When generating a SPEC for a multi-phase feature:

1. **Capture the external shape with a live probe BEFORE writing types** (this we did — `library-probe.md`).
2. **Mirror the probe's exact field names in the type definition**, even if it looks redundant. Don't collapse fields you don't yet understand.
3. **Phase 1 unit tests should construct a complete fixture from the probe log** and round-trip it through the new type — not just assert that types compile.
4. **Run `pnpm typecheck` after Phase 1** with a stubbed Phase 2 call site that *uses* the types as intended. If the type shape forces awkward field gymnastics, fix the type in Phase 1.

## Heuristic for spec-generation

If your spec introduces a new "domain type" (Money, TokenUsage, Cost, etc.) and a separate "external SDK shape," the spec's verification matrix should include a *type-level alignment test* that constructs the domain type from a real probe sample. The cost-breakdown SPEC has this (REQ-005 references `probes/usage-shape.live.log`); the original draft did not, which is how the mismatch slipped in.
