# Calendar Report Redesign Adversarial Findings

## Attack Surface Derived

- Long ranking titles can previously disappear behind `truncate`.
- Dialog max-width can be constrained by the shared Radix dialog default `sm:max-w-lg`.
- Report content can overflow vertically after adding more whitespace.
- Mobile width can force side-by-side report cards into unreadable columns.

## Scenarios Attempted

| ID | Category | Description | Inputs | Verdict |
|---|---|---|---|---|
| ADV-1 | Boundary content | Open report with long previous and draft titles, long rationale, source host links, prompt snapshots. | Mocked calendar SSE response with long titles and prompt text. | EXPECTED |
| ADV-2 | Layout constraint | Check desktop modal width against default shared dialog constraints. | `1280x900` viewport; inspected dialog rect. | EXPECTED after fixing `sm:max-w-none` |
| ADV-3 | Overflow recovery | Check report body scroll container after rankings and prompts exceed available height. | Inspected `calendar-report-layout` scroll metrics. | EXPECTED |
| ADV-4 | Mobile reflow | Resize to `390x844` with the modal open and verify ranking cards stack. | Playwright mobile viewport; inspected ranking card rects. | EXPECTED |

## Defects

None remaining.

During verification, ADV-2 initially exposed the shared dialog default `sm:max-w-lg` overriding the intended width at desktop. The implementation now explicitly sets `sm:max-w-none`, and the desktop rect verifies the modal expands to `1248px` at `1280px` viewport width.

## Cannot Assess

- Real production data with more than ten ranked rows was not executed against the live LLM pipeline. The scroll-container evidence covers the UI behavior without running a paid ranking job.

## Honest Declaration

No defects found across 4 scenarios attempted after the width override fix. The most promising attack was the shared dialog max-width override, because it reproduced the compact report even after the component redesign; that defect was fixed and re-verified with the desktop bounding box evidence in `proof-report.md`.
