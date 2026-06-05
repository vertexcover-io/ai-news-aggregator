# Tech Debt Fix Pass — 2026-06-04 audit (issues #247–#251)

**Verification verdict:** ✅ PASS — [verification/proof-report.md](verification/proof-report.md) (VS-1..VS-5, 7 UI screenshots, pipeline boot proof) · Quality gate: PASS (9/9 checks)

Five behavior-preserving fix streams consuming the tech-debt manifest (`.harness/tech-debt/2026-06-04/findings.json`, 1,085 findings) under the auto-fix handoff contract — one PR per tracking issue. Every finding reached a terminal disposition: **141 fixed · 198 issue · 737 suppressed · 9 dropped (all reasoned)**.

| Artifact | Purpose |
|----------|---------|
| [design.md](design.md) | Fix strategy per issue, scope decisions, dependency fallback chain |
| [spec.md](spec.md) | EARS requirements REQ-1..8, edge cases, verification scenarios |
| [plan.md](plan.md) | 5-phase plan, context-map decisions/standards honored, file-ownership map |
| [library-probe.md](library-probe.md) | Exact bump targets verified live on the registry (VERIFIED ×11, SKIPPED ×1, DEFERRED ×1) |
| [learnings.md](learnings.md) | Pipeline friction captured (worktree artifact paths, vitest 4 blocker, CC expectations) |
| [verification/proof-report.md](verification/proof-report.md) | Per-VS proof with command tails + screenshots |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Role-swap break attempts on the refactored paths |

**Library probe:** no new libraries; 11 bump targets VERIFIED (drizzle-orm 0.45.2, hono 4.12.23, @hono/node-server 1.19.14, react-router-dom 7.16.0, vite 8.0.16, bullmq 5.78.0, …); vitest 4 attempted and reverted per fallback policy; ai@6 deferred (needs live cost probes per repo learnings).

**PRs:** 
| PR | Issue | Stream |
|----|-------|--------|
| [#253](https://github.com/vertexcover-io/ai-news-aggregator/pull/253) | #247 | Dependency CVE + staleness bumps |
| [#254](https://github.com/vertexcover-io/ai-news-aggregator/pull/254) | #251 | Dead-code removal |
| [#255](https://github.com/vertexcover-io/ai-news-aggregator/pull/255) | #249 | Architecture decomposition |
| [#256](https://github.com/vertexcover-io/ai-news-aggregator/pull/256) | #248 | Complexity refactors |
| [#257](https://github.com/vertexcover-io/ai-news-aggregator/pull/257) | #250 | Duplication extraction |

