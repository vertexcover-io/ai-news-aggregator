# Verification Stubs (VS-0) — promoted from library probe

### VS-0-markdown-render: Library probe — react-markdown + dompurify render/sanitize
**Type:** api
**Run:** bash .harness/review-page-enhancements/probes/markdown-render/probe-markdown-render.sh
**Expected:** exit 0; dompurify strips script/onerror/javascript:; react-markdown renders
heading/bold/link/list; raw HTML in markdown is escaped (not injected).
