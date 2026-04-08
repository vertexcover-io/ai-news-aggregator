# Parallel orchestrator phases must run in isolated worktrees, not a shared directory

When the orchestrator dispatches sub-agents in parallel (or back-to-back phases that overlap with WIP from a previous phase), each agent must operate in its own git worktree. If multiple phases share the same worktree directory, a later-phase agent will see the prior phase's uncommitted/staged files and treat them as part of its own starting state — leading to confused diffs, accidental reverts, and quality-gate failures on files the agent never touched.

Rules for orchestrator authors:
1. Every parallel sub-agent gets its own worktree path; never reuse the parent worktree for child agents.
2. Sequential phases that follow a phase which left WIP must either (a) commit/stash the WIP before handing off, or (b) run in a fresh worktree branched from the prior phase's commit.
3. Phase prompts should explicitly state the expected starting state ("clean tree at commit X") so the agent can verify and bail out if it sees unexpected files.

Why: In the run-ui run, phase 3 and phase 4 agents both saw pre-existing phase-2 WIP files in the shared worktree and had to reason around them, wasting tool calls and risking incorrect edits. Worktree isolation is the standard fix and it's already supported by `superpowers:using-git-worktrees` — the orchestrator just needs to use it for every parallel branch.
