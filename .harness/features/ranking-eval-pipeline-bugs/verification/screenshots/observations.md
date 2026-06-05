# Screenshot Observations

## Expected Ordering

Top-level `/admin/eval` ordering is admin nav, page header, prompt editor/results area, and right-side run controls. The run controls remain adjacent to the results section.

## PHASE1-C1-report-dialog.png

- **PHASE1-C1 — MET** — Screenshot `docs/spec/ranking-eval-pipeline-bugs/verification/screenshots/PHASE1-C1-report-dialog.png` shows the row-level report dialog titled `Report · manual-demo-1779440116981`, with the report table visible. The table contains score strip values `nDCG@10 0.910`, `P@10 0.800`, `must-recall 1.000`, and the actual-vs-expected row containing `Expected proof story` and `Actual proof story`.
- **Open visual review:** The modal is centered, the close control is visible, the report table is not clipped horizontally, and the background page remains visually subordinate behind the dialog. No overlapping text or controls observed.

## PHASE1-C2-C3-results-table.png

- **PHASE1-C2 — MET** — Screenshot `docs/spec/ranking-eval-pipeline-bugs/verification/screenshots/PHASE1-C2-C3-results-table.png` shows exactly one report affordance for the completed row: button aria label `Report for manual-demo-1779440116981`. No extra report controls are present outside the completed result row.
- **PHASE1-C3 — MET** — Screenshot `docs/spec/ranking-eval-pipeline-bugs/verification/screenshots/PHASE1-C2-C3-results-table.png` captures the recovery path after selecting a fixture from Top-N: fixture select value is `manual-demo-1779440116981`, `fixtureSelectDisabled=false`, `singleChecked=true`, `topNChecked=false`, and the row text is `manual-demo-1779440116981done0.9100.8001.000yes$0.0010 cachedReport`.
- **Open visual review:** The added `Report` column appears after Cost and remains aligned with the row. The fixture select and scope radios remain readable in the run rail. The result row has no visible overlap with the aggregate hero or total-cost footer.
