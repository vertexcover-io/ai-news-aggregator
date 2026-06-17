import type { LlmTxtSite, LlmTxtStaticPage } from "./types.js";

export const LLM_TXT_SITE: LlmTxtSite = {
  title: "AgentLoop — AI News, curated daily",
  summary:
    "A daily, human-reviewed digest of the most important AI news, ranked and recapped " +
    "from 34+ sources by an agentic pipeline. This file indexes published issues, the " +
    "must-read canon, and how the system is built, for consumption by LLMs and AI agents.",
};

export const LLM_TXT_STATIC_PAGES: LlmTxtStaticPage[] = [
  {
    title: "How we build it",
    path: "/",
    description:
      "The harness-engineering manifesto and the end-to-end pipeline: sources → collect → " +
      "enrich + dedup → shortlist → rank + recap → human review → ship.",
  },
  {
    title: "Archive",
    path: "/archive",
    description: "Every published daily issue.",
  },
  {
    title: "Sources",
    path: "/sources",
    description: "The sources we collect from and their health.",
  },
];
