---
governs: packages/web/src/components/sources/
last_verified_sha: 5a2ff20
key_files: [SourceCatalog.tsx, sourceCatalogUtils.ts]
flow_fns: []
decisions: []
status: active
---

# components/sources/ — sources catalog display

## Purpose

Renders the configured sources reading list on the public `/sources` page: sections grouped by `SourceType`, each row showing the source's display name, URL, and a meta line.

## Public surface

| Export | Effect |
|---|---|
| `SourceCatalog({ sections, variant })` | Renders source sections (grouped by `sourceType`): section header with label + count, then a list of source rows with display name + URL + meta |
| `sourceCatalogUtils.ts::sourceTypeLabel(type)` | Maps `SourceType` enum to display label: "Hacker News", "Reddit", "Twitter/X", "Blogs", "RSS Feeds", "GitHub", "Newsletters", "Web Search" |

## Depends on / used by

- **Uses:** `@newsletter/shared/types` (SourceType enum)
- **Used by:** `pages/SourcesPage.tsx`, `pages/SourcesPreviewPage.tsx`

## Gotchas / landmines

- **Web search queries display differently**: For `web_search` sourceType, the count label is "N queries" instead of "N sources", and the meta line shows "via Tavily".
