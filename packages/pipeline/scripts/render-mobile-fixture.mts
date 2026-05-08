import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderNewsletter } from "../src/lib/email-render.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "..", "..", "docs", "spec", "fix-email-mobile-responsive", "verification", "ui");
mkdirSync(outDir, { recursive: true });

const baseUrl = "https://newsletter.vertexcover.io";

// Use a deliberately long headline to stress the mobile fix — same kind of
// title that broke in the user's screenshot ("Multi-Token Prediction (MTP) for
// LLaMA.cpp - Gemma 4 speedup by 40%").
// Long fixture: 8 stories so we exercise post-cap rendering visually.
const longProps = {
  stories: Array.from({ length: 8 }, (_, i) => ({
    title: `Story ${String(i + 1)} — ${["A long-horizon planning failure mode", "Edge inference quietly ships", "Flow maps cut diffusion cost", "MTP lands in llama.cpp", "Probing Gemma 3's latents", "Compute partnership shake-up", "Open-web AI-slop reaches a tipping point", "Sandbox spec adds rollback semantics"][i]}`,
    url: `https://example.com/${String(i + 1)}`,
    summary: `One-line summary of story ${String(i + 1)} for stress-testing the layout with realistic prose.`,
    bullets: [
      "First take that captures the headline finding.",
      "Second take that adds nuance.",
      "Third take that ties it back.",
    ],
    bottomLine: `Bottom line for story ${String(i + 1)} — short, italic, and to the point.`,
  })),
  issueDate: "Friday, May 8, 2026",
  issueNumber: 142,
  unsubscribeUrl: `${baseUrl}/api/unsubscribe?token=demo`,
  baseUrl,
};

const props = {
  stories: [
    {
      title: "Multi-Token Prediction (MTP) for LLaMA.cpp — Gemma 4 speedup by 40%",
      url: "https://www.reddit.com/r/LocalLLaMA/comments/abc",
      summary:
        "A community-maintained MTP patch lands in llama.cpp, with claimed 40% throughput gains on Gemma 4 13B at the cost of ~10% extra VRAM.",
      bullets: [
        "Patch is opt-in via -mtp flag; default behavior unchanged.",
        "Independent benchmarks confirm 35-42% on M2 Pro and RTX 4090.",
        "TP=8 still beats TP=4 on mixed-topology hardware.",
      ],
      bottomLine: "If you run Gemma 4 locally, it's a free 40% — but profile your actual NVLink topology before assuming more GPUs will help.",
    },
    {
      title: "Long-horizon planning still defeats agents — even with hierarchical replanning.",
      url: "https://arxiv.org/abs/2605.04127",
      summary: "Three papers and one production post-mortem converge on the same finding.",
    },
    {
      title: "Edge inference chips ship — quietly.",
      url: "https://github.com/ggerganov/llama.cpp",
      summary: "No keynote. Three open-source toolchains updated their hardware support lists this week.",
    },
    {
      title: "You can now read Gemma 3's mind",
      url: "https://news.ycombinator.com/item?id=1",
      summary: "A new probing technique exposes Gemma 3's intermediate activations as text.",
    },
    {
      title: "Flow maps drop diffusion sampling cost ~40%",
      url: "https://arxiv.org/abs/2605.00001",
      summary: "Without quality drop in the published numbers.",
    },
  ],
  issueDate: "Friday, May 8, 2026",
  issueNumber: 142,
  unsubscribeUrl: `${baseUrl}/api/unsubscribe?token=demo`,
  baseUrl,
};

const html = await renderNewsletter(props);
const outPath = join(outDir, "newsletter-mobile-fixture.html");
writeFileSync(outPath, html, "utf8");
console.log("wrote:", outPath);

const longHtml = await renderNewsletter(longProps);
const longOut = join(outDir, "newsletter-8-stories-fixture.html");
writeFileSync(longOut, longHtml, "utf8");
console.log("wrote:", longOut);
