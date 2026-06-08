# Verification observations

Infrastructure note: dev servers started manually (API on :3000, Web on :5173).
Migration `0039_narrow_silver_samurai.sql` applied to add `draft_saved_at` column.
DB (port 5434) and Redis (port 6379) were already running.

## Expected page layout (Review page)
Top-level sections from top to bottom:
1. Top navigation bar (Dashboard / Settings / Analytics / Eval / Canon / View site)
2. Page header banner with heading and Back link
3. Main content area (digest meta fields, ranked items list, pool)
4. SaveBar fixed at bottom (unsaved counter + action buttons)

---

## Screenshot: VS-dashboard-initial.png

**Claims covered:** REQ-010 (legacy/unreviewed run shows "Ready to review"), REQ-011 (reviewed run shows "Reviewed")

**Spec-based checks:**
- REQ-010: Run `16bbff0a` shows "Ready to review" badge — MET (snapshot confirms `cell "Ready to review"`)
- REQ-011: Run `130223c2` shows "Reviewed" badge — MET (snapshot confirms `cell "Reviewed"`)

**Open visual review:** Dashboard renders two-column table with Date, Publish date, Status, Items, Sources, Cost, Action headers. Top nav and main content visible. No alignment issues, no clipping. "Ready to review" shows Review CTA link; "Reviewed" shows "View archive" link. Correct.

---

## Screenshot: VS-1-review-page-unreviewed.png

**Claims covered:** REQ-013 (unreviewed run shows both "Save draft" and "Save & publish"), REQ-015 (draft save stays on page, counter resets to 0)

**Spec-based checks:**
- REQ-013: `button "Save draft"` and `button "Save & publish"` both visible in SaveBar — MET (snapshot `e161`, `e164`)
- REQ-015 (partial — full after save):
  - Both buttons visible: MET
  - Unsaved counter at "0 unsaved changes": MET (snapshot `e159`)

**Open visual review:** Review page shows heading "📰 Newsletter" (h1), h2 "Review · Dec 1, 2399", item list with 2 posts, SaveBar at bottom with "0 unsaved changes" | "Save draft" | "Discard" | "Save & publish". No clipping, alignment looks correct.

**Adversarial L1 finding (counter resets from dirty):**
- Made list dirty: clicked title edit, typed " [EDITED]", pressed Enter → counter showed "1 unsaved change"
- Clicked "Save draft" → PATCH /api/admin/archives/16bbff0a... returned 200
- Counter returned to "0 unsaved changes" — MET
- URL stayed `/admin/review/16bbff0a-d7bc-4e5d-a99c-6ee7051ab34e` — MET
- DB: `reviewed=false`, `draft_saved_at=2026-06-08T11:21:20.371Z` — MET

---

## Screenshot: VS-1-dashboard-draft-badge.png

**Claims covered:** REQ-009 (draft status derived for run with draft_saved_at set), REQ-012 (Draft badge shows Review CTA)

**Spec-based checks:**
- REQ-009: After saving draft, run `16bbff0a` shows "Draft" badge in Status column — MET (JS evaluation: `draftBadgeText: "Draft"`)
- REQ-012: Review CTA link present at `/admin/review/16bbff0a-d7bc-4e5d-a99c-6ee7051ab34e` — MET (JS evaluation: `reviewLinkHref: "/admin/review/16bbff0a..."`)

**Open visual review:** Dashboard shows "Draft" badge in violet (visually distinct from "Ready to review" and "Reviewed"). The row has a Review link. Top nav visible at top, table rows visible below. No clipping.

**Public route check (VS-1 step 4):**
- `GET /api/archives/16bbff0a...` returns 404 with `{"error":"not found"}` — MET (draft absent from public API)
- Browser: no link to `16bbff0a` appears on `/` page — MET

**Rehydration check (VS-1 step 5):**
- Navigated back to `/admin/review/16bbff0a...` — page loaded with edited title "[EDITED]" visible — MET

---

## Screenshot: VS-3-reviewed-run-single-save.png

**Claims covered:** REQ-014 (already-reviewed run shows only single save button, no "Save draft")

**Spec-based checks:**
- REQ-014: `hasSaveDraftButton: false`, `hasSavePublishButton: false`, only `"Save & view archive"` — MET
- No "Save draft" button present for reviewed run — MET

**Open visual review:** Review page for reviewed run shows only "Save & view archive". No "Save draft" or "Discard" buttons visible. Top nav at top, content, SaveBar at bottom. Correct.

**Adversarial: EDGE-001 / REQ-008 — draft save on reviewed run:**
- PATCH `130223c2` with `publish: false` → 400 `{"error":"cannot save an already-published archive as a draft"}`
- DB: `reviewed=true`, `draft_saved_at=null` — unchanged — MET

**Adversarial: EDGE-004 / REQ-007 — no duplicate enqueue:**
- Set `email_sent_at` on `130223c2`, then PATCH with `publish:true` (default)
- BullMQ queue length before: 0, after: 0 — MET (email channel skipped, no re-enqueue)
