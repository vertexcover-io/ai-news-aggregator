# Learnings — subscribe-trigger-slack-notify pipeline run

**Date:** 2026-05-29

---

## 1. Harness path resolution in worktrees — recurrence confirmed

The `harness-path-resolution-in-worktrees` learning (`.claude/rules/learnings/harness-path-resolution-in-worktrees.md`) describes sub-agents writing artifacts to the main checkout's `.harness/` instead of the worktree's. **This happened again on this run.** The phase claims files (`phase-1-claims.json` through `phase-4-claims.json`) and the aggregated `claims.json` landed in the **main repo's** `.harness/subscribe-trigger-slack-notify/` and had to be hand-copied into the worktree's `.harness/`.

The existing learning covers the mechanism and the rule correctly. The only new observation: the copy is a one-liner once you know where to look —

```bash
cp /path/to/main/.harness/<SPEC>/*.json /path/to/worktree/.harness/<SPEC>/
```

No rule update needed; the fix procedure is already documented. The recurrence suggests the orchestrate pipeline's sub-agent spawning logic does not yet pass an explicit `--harness-dir` override. Until it does, the hand-copy workaround is the correct recovery step.

---

## 2. Scope-mismatched pipeline for an audit-style task

This feature was originally a two-part task: (1) an audit confirming no other broadcast markers shared the trigger-collision bug, and (2) a small Slack notification addition. The orchestrate pipeline ran a full 4-phase implementation cycle with brainstorm → spec → plan → code → review → verify, which added significant overhead to what was essentially a targeted fix.

The user pre-empted the gate question at planning time: "Is Option A (keep going) or Option B (simpler approach) better?" — signalling awareness of the pipeline overhead. In this case the full pipeline was the right choice because Part 2 (Slack notifications) had real implementation work and tests. But the pattern is worth noting:

**If the majority of a feature is "verify no other instances of X exist" (audit) + "add N lines of wiring", consider whether a single-agent coding session with `/harness:tdd` is sufficient rather than the full orchestrate pipeline.** The orchestrate pipeline's value is in long multi-phase implementations; for sub-200-line PRs that are primarily additive wiring, the planning + review overhead may exceed the implementation time.

No rule file created — this is a judgment call rather than a repeatable anti-pattern.

---

## 3. `countConfirmed` unguarded await (low-priority hardening note)

Identified during adversarial review (see `verification/adversarial-findings.md`, Scenario 2): the `countConfirmed()` call before firing Slack is awaited directly without a surrounding try/catch. If the DB drops between `updateStatus` succeeding and `countConfirmed` running, the subscriber's status is committed but the route returns 500 instead of a redirect. The subscriber is correctly subscribed; they just see an error page.

This is not a data-correctness bug and is consistent with the codebase's existing error-handling posture (DB failures propagate as 500 throughout the API). A follow-up hardening PR could wrap the `if (changed) { countConfirmed + notify }` block in a try/catch that logs and continues to the redirect, decoupling the Slack notification from the HTTP response on DB errors.

No rule file created — logging as a known improvement rather than a recurring pattern.
