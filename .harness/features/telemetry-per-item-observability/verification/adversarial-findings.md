# Adversarial Findings

## 1. Attack Surface Derived

- Source key parsing and route validation from REQ-003 / EDGE-006: malformed keys, unknown source types, and special characters.
- Failed/empty source rendering from REQ-011 / EDGE-007: log-only state must not retain stale items.
- Accordion state from REQ-001: switching sources must close the previous row and update `aria-expanded`.
- Payload minimality from REQ-014: API response must not serialize markdown, recap, or cost fields.
- Auth boundary from REQ-003: source-item route must reject missing admin cookie.

## 2. Scenarios Attempted

| ID | Category | Description | Inputs | Verdict |
|---|---|---|---|---|
| ADV-API-1 | Boundary input | Invalid run id should be rejected before lookup. | `GET /api/admin/runs/not-a-uuid/sources/reddit%3Ar%2FAI_Agents/items` with admin cookie. | EXPECTED: HTTP 400, body `{"error":"invalid runId"}`. |
| ADV-API-2 | Boundary input | Unknown source type should not reach query composition. | `sourceKey=mastodon:@acct` with admin cookie. | EXPECTED: HTTP 400, body `{"error":"invalid sourceKey"}`. |
| ADV-API-3 | Boundary input | Source key without `type:identifier` separator should be rejected. | `sourceKey=reddit` with admin cookie. | EXPECTED: HTTP 400, body `{"error":"invalid sourceKey"}`. |
| ADV-API-4 | Special characters | Failed source key with `@` should round-trip and return log-only payload. | `sourceKey=twitter:@karpathy` with admin cookie. | EXPECTED: HTTP 200, `items=[]`, zero summary counts, and one `source.failed` log. |
| ADV-API-5 | Auth boundary | Missing admin cookie should be rejected. | Healthy reddit source-item route without cookie. | EXPECTED: HTTP 401, body `{"error":"unauthorized"}`. |
| ADV-UI-1 | Unexpected sequence | Fresh load should not fetch source items until a row is expanded. | Reload run page, clear resource timings, then inspect before clicking. | EXPECTED: `panelCountBefore=0`, `itemRequestsBeforeExpand=0`. |
| ADV-UI-2 | Unexpected sequence | Switching from healthy expanded source to failed source must not retain stale item rows. | Expand reddit, then click twitter. | EXPECTED: reddit `aria-expanded=false`, twitter `aria-expanded=true`, `itemListCount=0`, failed panel has `source.failed`, and old healthy title absent. |
| ADV-UI-3 | Error recovery | Failed-source panel should still allow returning to healthy source data. | After failed panel, click reddit again. | EXPECTED: healthy panel fetch succeeds with the reddit source-item route and shows the item list. Covered by repeated MCP switching evidence; no console errors. |

## 3. Defects

None.

## 4. Cannot Assess

- Real production data volume and very long log strips were not assessed against an actual historical run; this verification used a deterministic seeded run.
- Real browser scrollbar rendering differences across operating systems were not exhaustively assessed; class evidence and viewport screenshots were checked on this local browser session.

## 5. Honest Declaration

No defects found across 8 scenarios attempted. Categories exercised: boundary inputs, special-character source keys, auth boundary, lazy fetch, stale-state switching, and failed-source recovery. The most promising attack was stale UI state after switching from a populated source panel to a failed empty source; it did not land because the failed panel closed the reddit row, removed the item list, and did not retain the healthy source title.
