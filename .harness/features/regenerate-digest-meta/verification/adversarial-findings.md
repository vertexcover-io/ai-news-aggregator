# Adversarial Findings — regenerate-digest-meta

Role-swap critic pass. Targets derived from spec ACs and the explicit break-it scenarios in the verify task.
All scenarios run live against the worktree's fresh API (`:3000`) + web (`:5173`), seeded archive
`aaaaaaaa-bbbb-cccc-dddd-000000000001` (reviewed, completed, non-dry-run, 3 ranked items) plus a dry-run
seed and an empty-ranked seed.

## 1. Attack surface derived

- **Regenerate endpoint boundary** (POST `/api/admin/archives/:runId/regenerate-digest-meta`):
  empty items, ids not in archive ranked set, 404 run, malformed JSON, dry-run archive, no-auth. *(spec REQ-005..009, EDGE-001/006; some are claim-covered e2e — re-probed live as the critic.)*
- **No-persist contract** (REQ-005): regenerate must return a blob but never touch DB digest columns; and the same must hold across an unsaved page reload.
- **UI Regenerate gating** (REQ-016/EDGE-001/EDGE-002): disabled at zero items; always-overwrite even after a manual edit.
- **Twitter Summary over-limit** (EDGE-003): UI warns but does not block; server has no hard cap, save persists >180.
- **PATCH digest field semantics** (REQ-010/011, EDGE-004/009): omit=preserve, explicit `null`=write null + recompute FTS, `""`=write empty string.
- **Public serialization** (REQ-014): public `/api/archives/:runId` must not expose `twitterSummary`.

## 2. Scenarios attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| A-NOAUTH | Permissions | Regenerate without admin cookie | no cookie | EXPECTED (401 `{"error":"unauthorized"}`, no LLM) |
| A-EMPTY-API | Boundary | Regenerate with empty items array | `{"items":[]}` | EXPECTED (400 "items cannot be empty") |
| A-UNKNOWN-ID | Boundary | Item id not in archive's ranked set | `id:999999` | EXPECTED (400 `{"error":"unknown ranked item ids: 999999","missingIds":[999999]}`, no LLM) |
| A-404 | Boundary | Non-existent runId | random uuid | EXPECTED (404 `{"error":"archive not found: …"}`) |
| A-MALFORMED-JSON | Boundary | Non-JSON body | `not-json{` | EXPECTED (400 "invalid json") |
| A-DRYRUN | Status/conflict | Regenerate on a dry-run archive | dry-run seed | EXPECTED (409 `{"reason":"cannot regenerate digest for a dry-run archive"}`) |
| A-NOPERSIST | No-persist (REQ-005) | Regenerate valid items, re-read DB | valid ids 304/305 | EXPECTED (200 4-field blob returned; DB `digest_headline` unchanged before/after) |
| A-EMPTY (browser) | UI gating (C6/EDGE-001) | Open review on empty-ranked archive | `ranked_items=[]` | EXPECTED (panel renders, Regenerate `disabled=true`) — screenshot `PHASE4-C6-regenerate-disabled-zero-items.png` |
| A-EDIT-REGEN (browser) | Always-overwrite (EDGE-002) | Manual edit headline → Regenerate | sentinel "MANUAL-EDIT-SENTINEL-ZZZ" | EXPECTED (sentinel overwritten by LLM headline; `overwroteManualEdit:true`) |
| A-RELOAD-NOSAVE (browser) | No-persist (REQ-005) | Regenerate then reload WITHOUT save | — | EXPECTED (headline reverts to last-persisted `PERSIST-CHECK-HEADLINE-7Q2`; unsaved regen not persisted) |
| A-SAVE-OVERLIMIT | No hard cap (EDGE-003) | PATCH twitterSummary 250 chars | 250-char string | EXPECTED (200; DB `length(twitter_summary)=250`) |
| A-OMIT-PRESERVE | Preserve (REQ-011) | PATCH only rankedItems | no digest keys | EXPECTED (digest_headline + hook unchanged) |
| A-NULL-HEADLINE | Write-null + FTS (EDGE-009) | PATCH `digestHeadline:null` | null | EXPECTED (`digest_headline IS NULL`; search_text drops old headline) |
| A-EMPTY-HOOK | Write-empty (EDGE-004) | PATCH `hook:""` | "" | EXPECTED (hook = empty string, distinct from omit) |
| A-PUBLIC-TWITTER | Serialization (REQ-014) | Public GET detail keys | no cookie | EXPECTED (no `twitterSummary` key; top-level keys verified) |

## 3. Defects

**None.** No DEFECT-class outcomes. Every malformed/over-budget/out-of-scope input was rejected
or handled with the spec-correct status and body, and every persistence-boundary contract held.

## 4. Cannot assess

- **PHASE4-C3 (in-flight loading affordance):** The live Anthropic regenerate call resolves between
  the click handler firing and the first browser poll tick — across two distinct polling strategies
  (500ms and 200ms intervals, plus a same-tick check) the `isPending` window was never observable
  in-browser. The disabled + `Regenerating…` + spinner state is driven directly by `mutation.isPending`
  in `DigestMetaPanel.tsx` and is covered by the component test `DigestMetaPanel.test.tsx::REQ-017`.
  CANNOT_ASSESS via browser; covered at unit level.
- **PHASE4-C4 (error state):** Forcing the live endpoint to fail would require breaking the API key /
  mocking, which the running server doesn't permit; the error rendering (`role="alert"`, fields unchanged)
  is covered by `DigestMetaPanel.test.tsx::REQ-018`. CANNOT_ASSESS via browser; covered at unit level.

## 5. Honest declaration

**No defects found across 15 scenarios attempted.** Categories exercised: permissions/auth, boundary
inputs (empty/unknown-id/malformed/404), status/conflict (dry-run 409), persistence contracts
(no-persist on regenerate, no-persist on unsaved reload, omit-preserve, write-null, write-empty,
no-hard-cap save), UI gating (disabled-at-zero, always-overwrite), and public serialization.

The most promising attack was **A-NOPERSIST + A-RELOAD-NOSAVE** — the spec's headline promise is that
regenerate is a *preview* that only persists on Save. I attacked it two ways: a direct API regenerate
followed by a DB re-read (column unchanged), and a browser regenerate followed by a reload without
saving (UI reverted to the persisted value). If the route had accidentally written through (a very
common mistake when a regenerate handler reuses a patch service), both probes would have caught it.
They didn't — the route returns the blob and stops, and the column only moves on an explicit PATCH.
The second-most-promising was **A-UNKNOWN-ID**: feeding an id absent from the archive's ranked set could
have leaked an unscoped LLM call or a 500; instead it's a clean 400 with `missingIds`, the LLM untouched.
