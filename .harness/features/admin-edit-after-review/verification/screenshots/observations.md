# Screenshot Observations

## VS1-dashboard-overview.png

**Expected ordering:** Nav → Dashboard header ("Recent runs" + subtitle) → Runs table with Date/Publish date/Status/Items/Sources/Cost/Action columns → Rows → Footer.

### Spec-based checks
- REQ-001: Kebab menu visible in Action column with "Edit newsletter", "Post to LinkedIn", "Post to X" items — `MET`
- Dashboard layout: Nav bar at top, table structure correct, rows show Status "Reviewed" / "Dry run" badges — `MET`

### Open visual review
- Layout correct: nav at top, table below with column headers, run rows showing status pills.
- "Edit newsletter" item visible in open kebab menu. Text is clear, not clipped.
- Menu appears overlaid correctly over the table row.
- No obvious alignment or overlap issues.
- Nothing wrong visually.

---

## REQ-001-reviewed-kebab-menu-enabled.png

**Expected ordering:** Nav → Dashboard header → Table → Open kebab dropdown with "Edit newsletter" at top.

### Spec-based checks
- REQ-001: "Edit newsletter" menu item visible, not aria-disabled (aria-disabled: null), has href pointing to /admin/review/<runId> — `MET` (verified programmatically: ariaDisabled=null, href="/admin/review/46fe5008-c920-40ad-9bfc-70f332bc7c20")
- REQ-002 (in same screenshot): Table rows with both "Reviewed" and "Ready to review" status visible — `MET`
- EDGE-003: Dry run row visible in table — `MET`

### Open visual review
- Menu items "Edit newsletter", "Post to LinkedIn", "Post to X" are rendered cleanly.
- "Edit newsletter" is the first item, clearly styled as a clickable link (not dimmed/disabled).
- Menu positioned correctly overlaid on the rightmost Action column.
- No clipping or overflow visible.
- Nothing wrong visually.

---

## REQ-005-REQ-006-edit-heading-and-banner.png

**Expected ordering:** Nav → Back to dashboard link → h2 heading "Edit · <date>" → Subtitle → Banner → AddPostPanel → DigestMetaPanel → SaveBar at bottom.

### Spec-based checks
- REQ-005: h2 reads "Edit · Jul 1, 2099" — `MET` (matches `/^Edit · /`)
- REQ-005 subtitle: "Update posts or copy — the archive and any unsent channels will pick up your changes." — `MET`
- REQ-006: Yellow amber banner "Already published: Email — edits won't change those. The archive and any unsent channels will update." — `MET`, banner lists "Email" (emailSentAt non-null), no LinkedIn or X (those timestamps null)
- Layout ordering: heading → subtitle → banner → AddPostPanel → DigestMetaPanel → bottom SaveBar ("0 unsaved changes | Discard | Save & view archive") — `MET`

### Open visual review
- Banner has amber/yellow border (#F59E0B range), appropriate warning styling.
- DigestMetaPanel shows Headline, Summary, LinkedIn post body fields — correctly below AddPostPanel.
- SaveBar at bottom: "0 unsaved changes", "Discard" and "Save & view archive" buttons visible.
- Heading typography: bold, appropriately large serif font.
- Nothing wrong visually.

---

## VS1-public-archive-after-edit-save.png

**Expected ordering:** Share bar at top → Edited story h2 title → Source eyebrow (HACKER NEWS · READ SOURCE) → Story content → Footer with logo, subscribe, nav.

### Spec-based checks
- REQ-005+EDGE-005: Public archive page shows "Edited Title After Functional Verify" as h2 — `MET`
- VS-1 step 5: Navigated to /archive/:runId, edited title is visible — `MET`
- Layout: Share bar → story title → source attribution → footer — `MET`

### Open visual review
- Title "Edited Title After Functional Verify" rendered as large serif h2, correctly sized.
- HACKER NEWS · READ SOURCE eyebrow text in monospace, correct.
- Footer fully visible: logo, subscribe form, MUST READ / SOURCES / HOW IT'S BUILT nav links.
- No content below footer area (empty story body expected since no content was seeded).
- Nothing wrong visually.
