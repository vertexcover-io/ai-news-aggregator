# Adversarial Findings

**Feature:** Manual LinkedIn / X (Twitter) Post Trigger  
**Date:** 2026-05-26

## Scenarios Attempted to Break

### 1. POST to already-posted LinkedIn archive (API)

**Attempt:** Called `POST /api/runs/bbbbbbbb.../post/linkedin` on an archive that already has `linkedin_posted_at` set.

**Result:** 409 Conflict with `{"error":"archive is already posted on this channel","reason":"already_posted"}`. Correct — no duplicate job enqueued.

**Finding:** No bug. Idempotency enforced correctly at the API layer.

---

### 2. POST to unreviewed archive (API)

**Attempt:** Called `POST /api/runs/cccccccc.../post/linkedin` on an archive with `reviewed=false`.

**Result:** 409 Conflict with `{"error":"archive is not eligible for posting","reason":"not_reviewed"}`. Correct.

**Finding:** No bug. Gate works correctly.

---

### 3. POST with invalid channel 'facebook' (API)

**Attempt:** Called `POST /api/runs/aaaaaaaa.../post/facebook`.

**Result:** 400 with `{"error":"invalid channel: must be 'linkedin' or 'twitter'"}`. Correct.

**Finding:** No bug. Zod validation rejects unknown channels.

---

### 4. POST with non-UUID runId (API)

**Attempt:** Called `POST /api/runs/not-a-uuid/post/linkedin`.

**Result:** 400 with `{"error":"invalid runId: must be a UUID"}`. Correct.

**Finding:** No bug. UUID validation works.

---

### 5. Click disabled menu items (UI)

**Attempt:** Opened the ⋮ menu on an unreviewed run and clicked on the disabled "Post to LinkedIn" item.

**Result:** No action fired, no dialog opened, no network POST. The `aria-disabled="true"` attribute and `disabled` property on the button prevented the click from triggering the confirm dialog or mutation.

**Finding:** No bug. Disabled items are correctly inert.

---

### 6. Cancel the confirm dialog (UI)

**Attempt:** Opened menu, clicked "Post to LinkedIn", opened confirm dialog, then clicked "Cancel".

**Result:** Dialog closed. No network POST was fired. No state change.

**Finding:** No bug. Cancel correctly dismisses without side effects.

---

### 7. Dry-run reviewed archive (UI + API adversarial)

**Attempt:** Seeded a reviewed, completed, `is_dry_run=true` archive. Opened its ⋮ menu.

**Result (UI):** Both items correctly aria-disabled — the UI correctly identifies dry-run as ineligible.  
**Result (API, from unit tests):** 409 with `reason: "dry_run"`.

**Finding:** No bug. Dry-run archives are consistently blocked at both UI and API layers.

---

### 8. Null permalink posted indicator (UI)

**Attempt:** Seeded an archive with `linkedin_posted_at` set but `social_metadata=NULL` (no permalink stored). Opened its ⋮ menu.

**Result:** LinkedIn item rendered as `"LinkedIn ✓ Posted"` in a `DIV` element (not an anchor), no href attribute. This is the correct graceful degradation — it shows a posted indicator without crashing or rendering a broken link.

**Finding:** No bug. Null permalink handled gracefully.

---

### 9. Attempted to enqueue a job for a run that is already LinkedIn-posted via the API directly (bypassing UI)

**Attempt:** Direct `curl` to `POST /api/runs/bbbbbbbb.../post/linkedin` with valid admin session cookie.

**Result:** 409 `already_posted`. The API correctly blocks re-posting even when called directly without the UI guard.

**Finding:** No bug. The API layer independently enforces idempotency, so the UI's "posted indicator shows instead of trigger" is a defense-in-depth — the API is the authoritative gate.

---

## Summary

No defects found during adversarial testing. All eligibility gates (reviewed, completed, not dry-run, not already-posted, valid channel, valid UUID) work correctly at both the UI layer (aria-disabled, no dialog opened) and the API layer (400/409 with descriptive reason). The null-permalink graceful degradation works as designed.
