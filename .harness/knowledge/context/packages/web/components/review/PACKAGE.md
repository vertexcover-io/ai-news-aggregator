---
governs: packages/web/src/components/review/
last_verified_sha: 5a2ff20
key_files: [ReviewList.tsx, ReviewCard.tsx, PoolSection.tsx, PoolCard.tsx, ReviewToolbar.tsx, AddPostPanel.tsx, DigestMetaPanel.tsx, ExpandedPreview.tsx, SafeMarkdown.tsx, SaveBar.tsx, EditableField.tsx, EditableBulletList.tsx]
flow_fns: [ReviewList.tsx::ReviewList, PoolSection.tsx::PoolSection, AddPostPanel.tsx::AddPostPanel, DigestMetaPanel.tsx::DigestMetaPanel]
decisions: [D-012, D-013, D-014]
status: active
---

# components/review/ — admin review curation UI

## Purpose

The admin review page lets the operator curate the daily digest: reorder ranked items (DnD), remove items, add items by URL, promote pool items, inline-edit recap fields, and manage digest-level metadata (headline, summary, hook, twitter summary, LinkedIn post body).

## Public surface

| Component | Effect |
|---|---|
| `ReviewList({ items, addedIds, onReorder, onDelete, onUpdateField, pendingCount, pendingPromotes, failedPromotes, onRetryPromote })` | DnD sortable list of `ReviewCard` items + pending add/promote/failure placeholders |
| `ReviewCard({ item, rank, isAdded, onDelete, onUpdateField })` | Single ranked item card: rank number, source badge, title, editable recap fields, delete button, GripVertical drag handle |
| `PoolSection({ runId, ...filters, onPromote, promotingIds })` | Pool of non-ranked items with toolbar (shortlist toggle, source filter, search, sort) + "Promote" action |
| `PoolCard({ item, onPromote, isPromoting, isSaveInFlight })` | Single pool item: collapsed by default, expand button toggles `ExpandedPreview` inline |
| `ReviewToolbar({ shortlistedOnly, toggleShortlisted, ...facets })` | Shortlist toggle checkbox + grouped source dropdown with removable chips; AND-composes with shortlist |
| `AddPostPanel({ runId, hasUrl, onPending, onResolved, onFailed })` | URL input + submit button; calls `addPost` API, manages pending state |
| `DigestMetaPanel({ runId, items, values, onChange, onRegenerated })` | Four editable digest fields (Headline, Summary, Twitter Summary) + LinkedIn post body editor + Regenerate button (POSTs to regenerate-digest-meta) |
| `ExpandedPreview({ preview, recapSummary })` | Switches on `preview.kind`: tweet (text + quoted + photos + "View on X"), link (OG + Readability markdown via `SafeMarkdown`), none (recap summary + "unavailable" fallback) |
| `SafeMarkdown({ markdown })` | DOMPurify-sanitizes HTML → renders via `react-markdown` (no `rehype-raw`) |
| `SaveBar({ unsavedCount, saving, canSave, disabledReason, onSave, onDiscard })` | Fixed bottom bar: unsaved changes count + Save/Discard buttons |
| `EditableField({ value, onChange, label, placeholder, as, rows })` | Inline-edit text input or textarea for recap fields |
| `EditableBulletList({ bullets, onChange })` | Inline-edit bullet list with add/remove rows |

## Depends on / used by

- **Uses:** `hooks/usePool`, `hooks/useReviewFilters`, `hooks/useSourceFacets`, `api/archives`, `@dnd-kit/core` + `@dnd-kit/sortable`, `dompurify`, `react-markdown`
- **Used by:** `pages/ReviewPage.tsx`

## Data flows

```
ReviewList → renders sortable list:
  DndContext + SortableContext(items.map(id), verticalListSortingStrategy)
    → PointerSensor + TouchSensor(activationConstraint: { delay: 250, tolerance: 5 })  (D-012)
    → onDragEnd: find fromIndex/toIndex → onReorder(fromIdx, toIdx)
  List items:
    ├─ ReviewCard for each ranked item (drag handle <GripVertical icon>, rank badge, sourceType·identifier badge, editable fields)
    ├─ Pending add placeholders ("Fetching post..." dashed border)
    ├─ Pending promote placeholders ("Processing — generating recap..." blue dashed)
    └─ Failed promote placeholders ("Recap generation failed" red dashed + Retry button)

PoolSection:
  usePool({ runId, enabled: !isUnavailable }) → accumulated items
    ├─ Sync filters: selectedSources → pool.setSources, selectedSourceTypes → pool.setSourceTypes, shortlistedOnly → pool.setShortlisted (D-013)
    ├─ Search input → 300ms debounce → pool.setQ
    ├─ Sort toggle: Engagement / Recent → pool.setSort
    ├─ Filter out promotedIds + promotingIds → visibleItems
    ├─ total === 0 && !isLoading → return null (D-006)
    └─ visibleItems → PoolCard list + loadMore button

AddPostPanel:
  URL input → isValidUrl check → hasUrl duplicate check
    → addPending({ tempId, url }) → addPost(runId, { url })
       ├─ success → onResolved(tempId, item) → item appended to ranked list
       └─ failure → onFailed(tempId) → error shown inline

DigestMetaPanel:
  Four editable fields: Headline, Summary, LinkedIn post body (textarea), Twitter Summary (with 180-char counter)
    → Regenerate button: POST regenerateDigestMeta(runId, items) → LLM response
       ├─ success → onChange({ headline, summary, hook, twitterSummary }) — overwrites all
       │    → rebuildLinkedinPostBody(null, items) → onChange({ linkedinPostBody }) (D-014)
       └─ failure → inline role="alert" error
```

## Gotchas / landmines

- **Touch sensor activation constraint** (D-012): `delay: 250, tolerance: 5` prevents scroll from triggering drag on mobile. Without this, users can't scroll through the review list.
- **DigestMetaPanel Regenerate always-overwrites** (D-014): The Regenerate button overwrites ALL four digest fields with the LLM response, even if the operator has manually edited some of them. This is by design — the regenerate flow is "synthesize fresh from current ranked items." The operator can re-edit after regeneration.
- **Pool filters are server-side**: `selectedSources` and `selectedSourceTypes` trigger `pool.setSources`/`pool.setSourceTypes` which reset the pool offset and re-fetch. The pool API handles the filter server-side. The review page's ranked list is NOT filtered — only the pool is.
- **ReviewCard uses `recap.title` as display title**: If an operator edits the title field, it updates `item.title` AND `item.recap.title`. The three-tier precedence is `ref.title > recap.title > sourceTitle`.

## Decisions

### D-012: Touch sensor activation constraints for mobile scroll

**Why:** Mobile users need to scroll the review page without accidentally triggering drag reordering. The 250ms delay + 5px tolerance from `@dnd-kit` ensures scroll gestures aren't captured as drag starts.

**Tradeoff:** 250ms feels sluggish for intentional drag on mobile. Acceptable — reordering is a deliberate action, not a frequent one.

**Governs:** `components/review/ReviewList.tsx`

### D-013: Pool filter state flows through usePool server-side

**Why:** Pool items can number in the hundreds; client-side filtering would load all items then narrow, wasting bandwidth. `usePool` sends filter params to the API and re-fetches.

**Tradeoff:** Filter changes trigger a network round-trip. The 300ms debounce on search mitigates this for typing. Source facet changes (checkbox click) are immediate — acceptable.

**Governs:** `components/review/PoolSection.tsx`, `hooks/usePool.ts`

### D-014: DigestMetaPanel Regenerate always-overwrites

**Why:** The Regenerate button is semantically "synthesize fresh digest meta from current ranked items" — it's not an incremental edit. Preserving operator edits would require a merge algorithm that's not worth the complexity.

**Tradeoff:** An operator who manually edits the headline, then clicks Regenerate, loses their edit. The UX mitigates this by making Regenerate a deliberate action with a distinct button, not an automatic trigger.

**Governs:** `components/review/DigestMetaPanel.tsx`
