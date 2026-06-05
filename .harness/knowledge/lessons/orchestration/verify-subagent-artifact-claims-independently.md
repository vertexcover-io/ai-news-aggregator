# Verify sub-agent artifact claims independently; mandate absolute `--outputFile` paths

**Category:** orchestration / multi-agent pipelines
**Discovered:** eval-report-component (2026-05-23), Phase 2 coder sub-agent

## Problem

A coder sub-agent reported that it had written its phase claims file
(`.harness/<spec>/phase-2-claims.json`) and a Vitest JSON results file. In reality it
had written **neither to the expected location**: the claims file was missing, and the
Vitest JSON was emitted to a *relative* path under `packages/web/.harness/` (resolved
against the sub-agent's per-package CWD) instead of the orchestrator's
`.harness/<spec>/` directory. The orchestrator trusted the sub-agent's success report,
then later failed to find the artifacts and had to **regenerate the claims file and
re-run the tests** to confirm the phase actually passed — wasted a full verification cycle.

## Why it happens

- Sub-agents run with a different (often per-package) working directory than the
  orchestrator. A relative `--outputFile=.harness/...` or `--reporter` path resolves
  against the sub-agent's CWD, not the repo root — so the file lands somewhere the
  orchestrator never looks.
- Sub-agents narrate intent ("I wrote X") and the orchestrator treats narration as fact.
  An agent's claim that an artifact exists is **not** evidence the artifact exists.
- In a monorepo with Turborepo/pnpm `--filter`, the CWD shift is silent and easy to miss.

## Rule

1. **Never trust a sub-agent's "I wrote the file" report.** After any sub-agent that is
   supposed to produce an artifact (claims JSON, test-results JSON, coverage report),
   the orchestrator MUST independently `ls`/`stat`/parse the artifact at its expected
   absolute path before proceeding. Missing or empty → re-run, don't continue.
2. **Instruct sub-agents to use ABSOLUTE paths for every `--outputFile` / reporter /
   output flag**, anchored at the harness dir, e.g.
   `--outputFile=/abs/path/.harness/<spec>/phase-N-vitest.json`. Pass the absolute
   harness dir into the sub-agent prompt; do not let it construct a relative one.
3. **Treat artifact existence as the phase's pass signal, not the agent's prose.** The
   claims file and the test-results JSON are the contract; if they aren't on disk at the
   agreed absolute path, the phase did not complete regardless of what the agent said.

## Heuristic

If a pipeline stage's success is asserted by a sub-agent but consumed by the
orchestrator via a file, add a one-line existence+shape check between them. The check is
cheap; the silent-missing-artifact failure costs a full re-run and erodes trust in every
downstream "passed" verdict.
