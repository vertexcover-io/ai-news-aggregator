# Verification Stubs (VS-0) — promoted from library-probe

### VS-0-chrono-node-relative: Library probe — chrono-node relative + absolute parsing
**Type:** api
**Run:** `node .harness/web-collector-date-fix/probes/chrono-node/probe-relative.mjs`
**Expected:** exit 0; relative inputs ("4 hours ago", "2 days ago", "yesterday")
resolve to the correct absolute instant relative to the fixed reference
`2026-05-26T12:00:00.000Z`; ISO input round-trips exactly; garbage/empty → `null`
with no throw.
**Note:** probe runs in an isolated `/tmp` dir; re-running requires
`npm install chrono-node@2.9.1` in that dir (the saved `.mjs` documents the cases).
Once chrono-node is a pipeline dependency, functional-verify may instead exercise
the in-repo `resolvePublishedDate` unit tests which cover the same matrix.
