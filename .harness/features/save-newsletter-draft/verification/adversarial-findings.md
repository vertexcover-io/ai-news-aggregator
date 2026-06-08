# Adversarial Findings — save-newsletter-draft

Verifier role swapped to critic. Re-read spec.md and claims.json only. Identified attack
surface from spec ACs not in claims (UI claims), spec edge cases, and boundary values.

---

## 1. Attack surface derived

From spec ACs vs claims.json gaps:
- UI claims (REQ-009/010/011/012/013/014/015/EDGE-002/003/006) — not proven by unit tests alone
- EDGE-006 (error recovery during draft save) — unit claim, test against real server
- EDGE-002 (publish after draft → "reviewed" status overrides "draft") — state transition in live UI

Boundary inputs explored:
- Empty rankedItems array in PATCH body
- Missing `publish` field (backward compat)
- Draft save on already-published run
- Draft save by unauthenticated caller
- Double draft save (idempotency)

Unexpected sequences:
- Make list DIRTY (inline edit title) then save draft → counter must return to 0 (L1 lesson)
- Publish run after it was drafted → confirmed UI shows "Reviewed" not "Draft"

Permissions:
- Unauthenticated PATCH

Broader surface (already-sent channels / duplicate publish):
- Set email_sent_at non-null, then PATCH with publish:true → queue must stay at 0

Slack hermeticity (user requirement):
- Verify e2e env forces SLACK_WEBHOOK_URL="" and notifier no-ops on empty string

---

## 2. Scenarios attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| ADV-01 | L1 reset | Dirty list (inline edit title), Save draft, counter must return to 0 | Edit title → "1 unsaved change" → click Save draft | EXPECTED (counter=0, URL unchanged, PATCH 200) |
| ADV-02 | Double submit | Second draft PATCH on same run (EDGE-007) | Same payload sent twice | EXPECTED (idempotent: 200, reviewed=false, draft_saved_at refreshed) |
| ADV-03 | Boundary — empty items | rankedItems=[] in draft PATCH | `{"publish":false,"rankedItems":[]}` | EXPECTED (400: "rankedItems cannot be empty") |
| ADV-04 | Backward compat | Missing `publish` field defaults to true (REQ-006) | `{"rankedItems":[...]}` — no publish field | EXPECTED (200, reviewed=true) |
| ADV-05 | State guard | Draft save after run published (EDGE-002) | `{"publish":false,"rankedItems":[...]}` on reviewed=true run | EXPECTED (400: "cannot save an already-published archive as a draft") |
| ADV-06 | Auth | Unauthenticated draft PATCH | No session cookie | EXPECTED (401: "unauthorized") |
| ADV-07 | Duplicate send | Publish run with email_sent_at already set (EDGE-004/REQ-007) | PATCH publish=true on run with email_sent_at != null | EXPECTED (200, queue length stays 0 — email channel skipped) |
| ADV-08 | Slack hermeticity | Verify e2e never sends real Slack | Inspect playwright.config.ts + notifier impl | EXPECTED (SLACK_WEBHOOK_URL="" in e2e env; notifier returns no-ops; logs "slack.notify.disabled") |
| ADV-09 | UI rehydration | Reload draft page after save → edits must persist | Navigate away and back to /admin/review/:runId | EXPECTED (edited title "[EDITED]" visible on reload) |
| ADV-10 | VS-3 single button | Reviewed run shows only one Save button | Navigate to reviewed run review page | EXPECTED (only "Save & view archive" present) |

---

## 3. Defects

None found.

---

## 4. Cannot assess

| Scenario | Reason |
|----------|--------|
| EDGE-006: Error toast when draft save fails | Cannot easily inject a DB error during a live PATCH without stopping the server; the unit test for this path passes (mock failing client). The error path is covered by the unit test `test_EDGE_006_draft_save_error_preserves_state`. |
| Touch-device drag reorder + Save draft | No real mobile device available; drag handle keyboard test used instead. |
| Two concurrent tabs submitting draft save | Race condition testing requires precise timing coordination not available via single Playwright session. |

---

## 5. Honest declaration

No defects found across 10 scenarios attempted. Categories exercised: boundary inputs (empty array, missing field), state guards (draft on published, publish defaults), auth boundary (unauthenticated), idempotency (double submit), already-sent channel dedup, Slack hermeticity, L1 reset from dirty state, rehydration on reload.

Most promising attack was ADV-01 (the L1 reset path flagged in relevant-lessons.md): the concern was that the unsaved counter might stay non-zero if derived state (digestBaseline, regenSignature) wasn't fully reset alongside the react-hook-form reset. The attack found the counter DID return to 0 after a genuinely dirty inline edit → Save draft sequence. The implementation correctly calls `reset()` plus clears the digest baseline state per L1.

Second most promising was ADV-07 (duplicate send): set `email_sent_at` non-null then published again. Queue length stayed at 0, confirming the existing per-channel `sentAt != null` skip logic was untouched.

**Slack hermeticity (explicit adversarial check):**
Attempted to trigger Slack during e2e by verifying the hermetic playwright.config.ts sets `SLACK_WEBHOOK_URL: ""` as a hard process-env override (not a passthrough). The `createSlackNotifier` in `packages/shared/src/slack/notifier.ts` (line 38-44) explicitly checks `webhookUrl === undefined || webhookUrl === ""` and returns a no-op notifier logging `slack.notify.disabled`. Dotenv's default `config()` (no `override: true`) does not replace a pre-set empty string. **Confirmed: no live Slack send possible during e2e.**
