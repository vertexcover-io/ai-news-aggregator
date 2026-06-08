# Screenshot Observations

**Expected layout ordering (AdminLayout invariant):**
Top → header nav (Dashboard / Settings / Analytics / Eval / Canon / Incidents / View site ↗ + Sign out button) → main content area (`<main>`): h1 "Incidents" → subtitle paragraph → filter controls (Status + Severity dropdowns) → incidents table or empty state. This ordering was confirmed present in every screenshot (header visible at top edge, footer/notification region at bottom).

---

## PHASE4-C1-incident-list-with-rows.png

**Claims evidenced:** PHASE4-C1

**Spec-based checks:**

| Requirement | Verdict | Evidence |
|-------------|---------|---------|
| Page renders a table row per incident | MET | Snapshot shows 3 rows: "Worker crashed with run" (critical), "API server crash" (critical), "Enrichment failure rate high" (warning) |
| Severity badge per row | MET | Snapshot: cells e43, e59, e136 contain severity text "critical"/"critical"/"warning" |
| Title per row | MET | Cells e45 "Worker crashed with run", e61 "API server crash", e76 "Enrichment failure rate high" |
| Source cell | MET | Cells e46 "pipeline", e62 "api", e77 "enrichment" |
| Occurrences count | MET | Cell e47 "3", e63 "1", e78 "2" |
| First seen (relative) | MET | Cells e48 "1h ago", e64 "2h ago", e79 "3h ago" |
| Last seen (relative) | MET | Cells e49 "34m ago", e65 "1h ago", e80 "2h ago" |
| Status badge | MET | Cells e50/e66/e81 all show "open" badge |
| Run link when runId present | MET | Cell e52 shows `link "Run ↗"` → `/admin/runs/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` |
| No run link when runId null | MET | Cells e68 and e83 show "—" (no link) |
| h1 heading "Incidents" | MET | Snapshot ref e17: `heading "Incidents" [level=1]` |
| Admin header nav present | MET | Snapshot: nav links Dashboard/Settings/Analytics/Eval/Canon/Incidents/View site all visible (refs e6-e12) |
| Filter controls present | MET | Comboboxes "Status" (e22) and "Severity" (e25) both visible |

**Open visual review:**
- Table renders cleanly with consistent padding (px-4 py-3 on cells)
- All 9 columns (Severity, Title, Source, Occurrences, First seen, Last seen, Status, Run, Actions) are present in header
- Resolve and Mute buttons visible for each open row
- No horizontal overflow visible
- No alignment issues observed
- Typography consistent (font-medium on Title, muted-foreground on Source)

---

## PHASE4-C2-empty-state.png

**Claims evidenced:** PHASE4-C2

**Spec-based checks:**

| Requirement | Verdict | Evidence |
|-------------|---------|---------|
| With zero incidents, page shows 'No incidents found.' | MET | Snapshot showed `paragraph: "No incidents found."` after deleting all rows from DB |
| No error message shown | MET | No "Failed to load" or error text visible in snapshot |
| Header nav still present | MET | Nav links all still visible (top edge) |
| Filter controls still present | MET | Status/Severity dropdowns visible (page structure intact) |

**Open visual review:**
- Empty state shows in a rounded border box (rounded-lg border bg-white p-8) with centered text
- "Try adjusting the filters." hint shown since filters are at default (not "all")
- Page structure is intact — no console errors from the empty state
- Clean, minimal empty state — no broken layout

---

## PHASE4-C3-severity-filter.png

**Claims evidenced:** PHASE4-C3

**Spec-based checks:**

| Requirement | Verdict | Evidence |
|-------------|---------|---------|
| Selecting 'critical' in Severity dropdown filters list | MET | After selectOption('critical'), snapshot confirmed "Enrichment failure rate high" (warning) hidden via `waitFor(textGone)` |
| Critical rows remain visible | MET | "Worker crashed with run" and "API server crash" both visible in snapshot after filter |
| Warning rows are hidden | MET | textGone wait succeeded: "Enrichment failure rate high" disappeared from DOM |
| Severity dropdown shows "Critical" selected | MET | selectOption call confirmed, Severity combobox shows "Critical" option selected |

**Open visual review:**
- Filter dropdown labels are clearly readable ("Status" / "Severity")
- Only critical-severity rows shown after filter applied
- Table structure intact with correct columns
- No layout shift from filtering

---

## PHASE4-C4-C5-resolve-mute-actions.png

**Claims evidenced:** PHASE4-C4, PHASE4-C5

**Spec-based checks:**

| Requirement | Verdict | Evidence |
|-------------|---------|---------|
| PHASE4-C4: Clicking Resolve sends PATCH status=resolved | MET | Clicked Resolve on "API server crash"; `waitForResponse(PATCH /api/admin/incidents)` completed successfully in e2e run |
| PHASE4-C4: Row leaves open filter without full reload | MET | After PATCH resolved, "API server crash" disappeared via `waitFor(textGone)` — only remaining open rows visible |
| PHASE4-C5: Clicking Mute sends PATCH status=muted | MET | Clicked Mute on "Enrichment failure rate high"; row disappeared from open filter |
| PHASE4-C5: Row leaves open filter without full reload | MET | "Enrichment failure rate high" gone from open view via `waitFor(textGone)` (no page navigation observed) |
| Screenshot shows post-action state | MET | Screenshot taken after both actions: only "Worker crashed with run" (critical, open) remains visible; no error shown |

**Open visual review:**
- After both actions, only one row remains ("Worker crashed with run") — correct since it was the only one not acted on
- No error toasts or console error indicators visible
- Table structure intact even after partial row removal
- Resolve/Mute buttons still present on remaining row

---

## PHASE4-C6-auth-redirect.png

**Claims evidenced:** PHASE4-C6

**Spec-based checks:**

| Requirement | Verdict | Evidence |
|-------------|---------|---------|
| Unauthenticated navigation to /admin/incidents redirects to /admin/login | MET | Page URL after navigation: `http://localhost:5174/admin/login?next=%2Fadmin%2Fincidents` |
| Login page shown (not 401 error page) | MET | Login form visible with "Admin" heading and Password input |
| `next` param preserved | MET | URL contains `?next=%2Fadmin%2Fincidents` — after login would return to incidents page |

**Open visual review:**
- Clean login page: "Admin" heading, password field, "Sign in" button, "← Back to archive" link
- No sensitive information leaked in the redirect
- Page header nav absent (correct — not logged in)

---

**Total screenshots:** 5 (within the 5-screenshot cap)
**Total size:** ~200KB (each ≤ 300KB limit)
