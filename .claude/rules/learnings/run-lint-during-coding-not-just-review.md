# Run lint during coding phases, not just at review

When writing or modifying code, run `pnpm lint` after each logical change — not just at the end during code review or quality gate. ESLint errors accumulate silently during coding phases and create friction when they're caught in bulk later.

The existing process rule requires `pnpm build` and `pnpm typecheck` before claiming work is done, but lint is equally important. All three checks (`pnpm build`, `pnpm typecheck`, `pnpm lint`) should pass after each coding phase, not just at the final gate.

Why: In the llm-selector-extraction run, 13 ESLint errors were introduced during coding and only caught at code review, requiring a separate fix pass. Running lint incrementally would have caught them as they were introduced.
