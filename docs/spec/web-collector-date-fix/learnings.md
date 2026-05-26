# Learnings — web-collector-date-fix

## Parallel-phase dispatch: what worked and what didn't

### What worked: phases 1 and 2 ran in parallel cleanly

The plan correctly identified that Phase 1 (`published-date.ts`, `convert.ts` changes) and Phase 2 (`web-date.ts`, `chrono-node`) touched entirely different files with no shared symbols between them. Dispatching them in parallel shaved ~50% off implementation time without any merge conflict or type-dependency issue. The isolation criterion was: **different files, no cross-imports between the two phases** — a reliable signal for safe parallel dispatch.

### What didn't work: claims artifacts didn't land, one agent drifted into Phase 3

After the parallel Phase 1 + Phase 2 dispatch:

- Phase 2's `phase-2-claims.json` and `phase-3-claims.json` files were not on disk at the expected harness paths. The sub-agents reported success in prose but the files weren't there.
- One sub-agent assigned to Phase 2 autonomously continued into Phase 3 — it recognized that Phase 3 depended on its Phase 2 output and decided to implement both. This worked out (Phase 3 was correct), but it means the orchestrator's Phase 3 dispatch was redundant and the harness state was inconsistent.

The orchestrator had to reconstruct the claims files from the phase vitest JSON reports and from `git diff`.

### What to do differently

1. **Treat the harness claims file as the phase completion signal** — if `.harness/<spec>/phase-N-claims.json` is absent after a sub-agent, the phase did not complete, regardless of prose. Verify with `ls` before dispatching Phase 3.
2. **Write explicit "do not implement Phase N+1" in parallel sub-agent prompts** — a capable sub-agent will see the dependency and try to help unless explicitly told to stop. Add: "Implement ONLY Phase N. Do not implement any subsequent phase even if you can see it depends on your output."
3. **The safe isolation criterion for parallel phases is: no shared symbols AND no shared files.** If one phase's output (a new exported function) is an input to another (an import in a different file), they are not truly independent — the second phase can only be dispatched after the first's output is on disk and type-checks.

### Cross-reference

See also: `docs/solutions/orchestration/verify-subagent-artifact-claims-independently.md` (artifact-landing problem) and `docs/solutions/orchestration/parallel-phase-agent-scope-drift.md` (agent drifting into the next phase).
