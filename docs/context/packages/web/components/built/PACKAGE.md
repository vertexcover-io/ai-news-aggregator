---
governs: packages/web/src/components/built/
last_verified_sha: 5a2ff20
key_files: [DefinitionTable.tsx, PipelineDiagram.tsx]
flow_fns: []
decisions: []
status: active
---

# components/built/ — static "How it's built" page

## Purpose

Static display components for the `/built` page: a definition table of terms and a pipeline diagram showing the data flow.

## Public surface

| Component | Effect |
|---|---|
| `DefinitionTable({ terms })` | Renders a list of term/definition pairs |
| `PipelineDiagram()` | Static SVG or ASCII-art style pipeline flow diagram |

Both are pure presentational components with no data fetching, no state, and no API calls.
