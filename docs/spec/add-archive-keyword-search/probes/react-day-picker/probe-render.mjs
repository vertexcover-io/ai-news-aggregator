// Probe: render react-day-picker v9 in range mode (2 months), verify DOM structure.
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { DayPicker } from "react-day-picker";
// CSS is bundled separately by Vite — not imported here in the SSR probe.

const selected = {
  from: new Date(2026, 3, 8),  // Apr 8, 2026
  to: new Date(2026, 4, 6),    // May 6, 2026
};

const html = renderToString(
  createElement(DayPicker, {
    mode: "range",
    numberOfMonths: 2,
    defaultMonth: new Date(2026, 3, 1),
    selected,
  })
);

const checks = {
  hasRoot: html.includes("rdp-root") || html.includes('class="rdp'),
  hasMonthGrid: (html.match(/role="grid"/g) || []).length >= 2,
  hasGridCells: (html.match(/role="gridcell"/g) || []).length > 30,
  containsApr8: html.includes("April 8") || html.includes("Apr 8") || html.includes(">8<"),
  containsMay6: html.includes("May 6") || html.includes(">6<"),
};
const ok = Object.values(checks).every(Boolean);

console.log(JSON.stringify({ ok, htmlLength: html.length, checks }, null, 2));
process.exit(ok ? 0 : 1);
