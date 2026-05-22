# Ranking eval pipeline — reviewer index

**Final verification verdict:** TBD

<!-- PR_URL: TBD -->

A purely-internal evaluation harness for the stage-2 reranker prompt. The
pipeline lets the operator (a) export historical run pools as graded
fixtures, (b) grade them in-app, (c) replay rerank with any candidate
prompt against the saved pool, and (d) score the output with nDCG@10 +
P@10 + must-include recall — both as a CLI workflow and a live
`/admin/eval` UI that supports two modes: **Mode A** (scored, single
fixture against ground truth) and **Mode B** (calendar, side-by-side
saved-vs-draft rankings for a recent date with no labels required).

## Contents

- [design.md](./design.md) — Problem framing, mode definitions, calendar pool sourcing
- [spec.md](./spec.md) — Requirements (REQ-*), edge cases, verification matrix
- [plan.md](./plan.md) — Phase decomposition (Phases 1–9)
- [library-probe.md](./library-probe.md) — Pre-spec verification of scoring math + SDK shapes
- [verification/proof-report.md](./verification/proof-report.md) — TBD (functional-verify stage)
- [verification/adversarial-findings.md](./verification/adversarial-findings.md) — TBD (review stage)

## Library-probe verdict

**PASS** — pure-internal feature, no external deps. nDCG implementation
verified against sklearn linear-gain form, worked example
nDCG@5 ≈ 0.8454.
