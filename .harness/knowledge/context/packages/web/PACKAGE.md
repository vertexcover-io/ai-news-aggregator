---
governs: packages/web/src/
last_verified_sha: ad0153a
sub_packages: [api, hooks, lib, layouts, pages, components/shell, components/archive-listing, components/review, components/dashboard, components/observability, components/eval, components/settings, components/sources, components/home, components/ui, components/built, pages/admin, components/admin/must-read]
decisions: [D-001, D-002, D-003, D-004, D-005, D-006, D-007, D-008, D-009, D-010]
status: active
---

# web — React + Vite frontend

## Purpose

Two-audience React SPA: a PUBLIC Ledger-aesthetic archive listing + detail for readers, and an ADMIN UI (password-gated) for the operator to review, curate, and publish the daily AI newsletter digest.

## Public surface

| Surface | Effect |
|---|---|
| `PublicLayout` | Wraps public routes: Masthead + Footer + `#FAFAF7` background |
| `AdminLayout` | Top-level nav for admin routes (Dashboard, Settings, Analytics, Eval, Canon, View site) |
| `RequireAdmin` | Route guard: checks `useAdminSession`, redirects to `/admin/login?next=` on 401 |
| `api/client.ts::apiFetch` | Fetch wrapper: adds `Content-Type: application/json` + `credentials: include` |
| `api/client.ts::apiFetchAdmin` | Same as `apiFetch` but 401 triggers redirect to `/admin/login` |

## Depends on / used by

- **Uses:** `@newsletter/shared` (types, constants, utils) via subpath imports ONLY (no root barrel to avoid DB leak into bundle)
- **Uses:** `@tanstack/react-query`, `react-hook-form`, `@dnd-kit/core`, `react-router-dom`, Tailwind CSS
- **Used by:** API server (serves static assets in prod), end users (browsers)

## Data flows (spine — 1 line per headline flow)

- **Public archive listing** (`HomePage`): `GET /api/home` → renders `TodaysIssueBlock` (hero), `FromTheCanonBlock` (featured canon), `ArchiveRow[]` (recent issues) — see `components/archive-listing/`
- **Public archive detail** (`ArchivePage`): `GET /api/archives/:runId` → renders `ArchivePageHeader` + `ArchiveStoryCard[]` in Ledger layout — see `pages/ArchivePage`
- **Admin login** (`AdminLoginPage`): `POST /api/admin/login` → invalidates `["admin","me"]` query → navigate
- **Admin dashboard** (`DashboardPage`): polls `GET /api/runs` at 2s intervals while active runs exist → renders `RunsTable`/`RunsCardList` — see `components/dashboard/`
- **Admin review** (`ReviewPage`): loads archive via `useReview`, renders DnD `ReviewList` + `PoolSection` (search/filter/promote) + `DigestMetaPanel` — see `components/review/`
- **Admin settings** (SettingsPage): react-hook-form + zod validation → PUT `/api/settings`
- **Collector health check** (SettingsSection): `SourcesSection` "Check"/"Check all" → `useCollectorHealthTrigger` → `POST /api/admin/collector-health/check` → `useCollectorHealth` polls `GET /api/admin/collector-health` every 2s while any collector is `running`, stops at terminal → `CollectorHealthModal` — see `components/settings/`
- **Admin observability** (RunObservabilityPage): polls `GET /api/admin/runs/:runId/observability` every 2s until terminal — see `components/observability/`
- **Ranking eval** (`EvalIndexPage`): prompt editor + scored/calendar eval modes with SSE streaming — see `components/eval/`
- **Sources page** (`SourcesPage`): `GET /api/sources/summary` → renders `SourceCatalog` — see `components/sources/`
- **Subscribe** (`Footer`, `InlineSubscribeCard`): `POST /api/subscribe` + `localStorage` subscription marker

## Sub-packages

| Sub-package | Role |
|---|---|
| `api/` | Typed HTTP client, one file per API domain, `apiFetch` + `apiFetchAdmin` base wrappers |
| `hooks/` | React Query hooks + local state management (review, pool, filters, eval runs) |
| `lib/` | Pure utility functions (formatting, analytics init, date math, share links) |
| `layouts/` | Route-level layout wrappers: PublicLayout, AdminLayout, RequireAdmin guard |
| `pages/` | Route-level page components, thin composition of hooks + components |
| `components/shell/` | Public site chrome: Masthead (nav + brand mark), Footer (subscribe + colophon) |
| `components/archive-listing/` | Public listing: ArchiveRow (live), SubscribeInline (live); SearchBar/DateRangeChip/FilterTabs now orphaned after the home listing moved to `GET /api/home` |
| `components/review/` | Admin review UI: ReviewList (DnD), PoolSection, DigestMetaPanel, AddPostPanel |
| `components/dashboard/` | Admin dashboard: RunsTable/RunsCardList, CostDialog, SocialOverflowMenu, ScheduleBanner |
| `components/observability/` | Per-run telemetry: RunFunnel, StageTimingRail, DebugTimeline, SourceTelemetryTable |
| `components/eval/` | Ranking eval admin: prompt editor, Mode A/B comparison, RunDetailDrawer, CalendarReportComparison |
| `components/settings/` | Settings form sections: SourcesSection, ScheduleSection, RankingPromptSection |
| `components/sources/` | Source catalog display: SourceCatalog, sourceCatalogUtils |
| `components/home/` | Home page hero blocks: TodaysIssueBlock, FromTheCanonBlock, ElsewhereStrip |
| `components/ui/` | shadcn base components: Button, Input, Dialog, Table, etc. (thin Radix wrappers) |
| `components/built/` | Static "How it's built" page components |
| `pages/admin/` | Admin Must Read list + edit pages |
| `components/admin/must-read/` | Must Read entry form component |

## Gotchas / landmines

- **Bundle leak through shared barrel** (D-001): `import from "@newsletter/shared"` (root) transitively pulls `postgres`/`drizzle-orm` into the browser bundle. Always use subpath imports like `@newsletter/shared/constants`. Enforced by the `web-shared-subpath-imports` learning rule.
- **apiFetchAdmin 401 redirect** (D-002): On 401, the client-side navigates to `/admin/login` with a `?next=` param. This means any admin API call returning 401 triggers a full page redirect — suitable for expired sessions, not for fine-grained auth errors.
- **Review page navigation guard** (D-003): Uses `useBlocker` (react-router) + `beforeunload` to prevent losing unsaved changes. The blocker must be explicitly bypassed (`allowSaveNavigation.current = true`) before the post-save navigate or the user gets a spurious confirm dialog.
- **Render-time hydration pattern** (D-004): Both `useReview` and `DigestMetaPanel` in `ReviewPage` use render-time state sync (`if completedKey !== hydratedId`) rather than `useEffect` cascading. This avoids React Strict Mode double-render issues where effects calling setState produce stale data.
- **Settings form wipe on re-render** (D-005): `SettingsPage` keys `form.reset` on `dataUpdatedAt`, not `data`, to avoid wiping in-progress dynamic-array edits when `setQueryData` from an optimistic save produces a new value-equal reference each render.
- **PoolSection total=0 hide** (D-006): When pool `total === 0` AND no active filter/search constraint AND no error, `PoolSection` returns `null` — this prevents the pool UI from rendering when the backend says there are genuinely no pool items. When a filter IS active, the section stays visible so the operator can clear the filter. Pool errors also stay visible with a Retry control.
- **Cross-tab subscription sync** (D-007): `useIsSubscribed` listens to both the `storage` event (for cross-tab localStorage) and a custom `newsletter-subscription-change` event (for same-tab). Without the custom event, subscribing in the footer wouldn't update an inline subscribe card rendered in the same tab.

## Decisions

### D-001: Subpath-only shared imports

**Why:** The shared package root barrel re-exports the Drizzle DB client, which transitively pulls `postgres`/Node builtins into the Vite bundle, breaking at runtime with `Buffer is not defined`.

**Tradeoff:** Every new shared export needed by web requires updating `tsup.config.ts` + `package.json#exports`. Acceptable for build safety.

**Governs:** `packages/web/src/**` — all imports from `@newsletter/shared` must use subpaths.

### D-002: Client-side 401 redirect

**Why:** The admin session cookie is HTTP-only; the client cannot inspect it. A 401 from any admin API call means the session expired — the correct UX is to redirect to login, not show an inline error on every component.

**Tradeoff:** Any single failed admin API call navigates the user away mid-flow. Fine for a single-operator tool; would be a problem for a multi-tab admin workflow.

**Governs:** `api/client.ts::apiFetchAdmin`

### D-003: useBlocker navigation guard on review

**Why:** The review page accumulates many edits (reorder, remove, add, field edits, digest meta). Losing those silently is unacceptable.

**Tradeoff:** The blocker fires for every location change — the save handler must set a ref to bypass it, which is easy to forget. The pattern is documented inline.

**Governs:** `pages/ReviewPage.tsx`

### D-004: Render-time hydration over useEffect cascading

**Why:** `useEffect` + `setState` in React 19 Strict Mode double-fires, and cascading effects can produce stale data. Render-time sync (`if key !== prevKey`) is deterministic.

**Tradeoff:** Violates the "no side effects in render" React rule technically, but the side effect is pure state update on a stable key comparison. The pattern is isolated to `useReview` and `ReviewPage` digest hydration.

**Governs:** `hooks/useReview.ts`, `pages/ReviewPage.tsx`

### D-005: Settings form reset keys on dataUpdatedAt

**Why:** `form.reset(data)` on every render would wipe in-progress edits to dynamic arrays (e.g., Twitter user fields). Keying on `dataUpdatedAt` (a monotonically increasing number) ensures reset only fires when the server actually returns new data.

**Tradeoff:** If the server returns the same `dataUpdatedAt` twice (shouldn't happen), the form won't re-hydrate.  `queryClient.setQueryData` produces a new `data` reference but same `dataUpdatedAt`, so it passes the guard.

**Governs:** `pages/SettingsPage.tsx`

### D-006: PoolSection null return only when unconstrained pool is empty

**Why:** Returning `null` keeps the review page clean when there are genuinely no pool items. However, when a filter is active and the filtered total is 0, the section must STAY rendered so the operator can see the active filter and clear it — otherwise they lose the only path to recovering normal pool view (the "filter UI vanishes" incident). The null-return gate now checks BOTH `total === 0` AND no active filter/search constraint.

**Tradeoff:** The component must track filter-active state to suppress the null-return. Pool error state must also suppress null-return so errors are always surfaced (not silently hidden by the zero-total check).

**Governs:** `components/review/PoolSection.tsx`

### D-008: Pool filter stale-total prevention via key-tracked total

**Why:** When the filter key changes (source, shortlist, search query), the react-query cache key changes and transitions through a loading state. The previous total must be suppressed during this transition — displaying a stale count next to a loading indicator confuses the operator about how many items exist.

**Tradeoff:** `usePool` must track the "last settled total for this key" separately from the raw react-query `data.total`. This uses the render-time sync pattern (D-004): `if queryCacheKey !== currentKey then total = null`.

**Governs:** `hooks/usePool.ts`, `components/review/PoolSection.tsx`

### D-009: Dry-run archives bypass the regenerate-before-save gate

**Why:** The regenerate-digest-meta API endpoint always returns 409 for dry-run archives (it's a preview-only feature for live runs). Blocking Save until Regenerate succeeds would permanently deadlock dry-run reviews. Dry-runs are test or ad-hoc archives — saving without fresh digest copy is acceptable.

**Tradeoff:** Dry-run archives save with potentially stale digest copy (whatever was seeded at run time). The Regenerate button is disabled with an explanatory reason to avoid operator confusion.

**Governs:** `pages/ReviewPage.tsx`, `components/review/DigestMetaPanel.tsx`

### D-010: Digest-meta fields tracked as unsaved changes in SaveBar

**Why:** Operators may spend time editing headline/summary/hook/twitter-summary/linkedin-post-body copy. Navigating away without saving should prompt for confirmation just as reordering does — these fields are first-class review outputs.

**Tradeoff:** The digest-meta "dirty" state must be checked separately from the ranked-items dirty state. In `ReviewPage`, both are combined into a single `unsavedCount` fed to `SaveBar`. `useBlocker` uses `hasUnsavedChanges = unsavedCount > 0`.

**Governs:** `pages/ReviewPage.tsx`, `components/review/DigestMetaPanel.tsx`, `components/review/SaveBar.tsx`

### D-007: Dual event listener for subscription state

**Why:** `localStorage` changes fire `storage` events across tabs but NOT in the same tab that wrote. A custom `newsletter-subscription-change` event bridges the gap.

**Tradeoff:** Requires every subscription write point to dispatch the custom event. Currently only `markSubscribed()` does. If a future code path writes directly to `localStorage`, the UI won't update.

**Governs:** `hooks/useIsSubscribed.ts`, `lib/subscriptionStorage.ts`
