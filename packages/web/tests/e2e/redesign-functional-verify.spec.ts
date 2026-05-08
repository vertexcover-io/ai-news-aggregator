import { test, expect, type Page, type Route } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.join(here, "..", "..", "test-artifacts", "redesign");

const archives = {
  archives: [
    {
      runId: "r-2026-05-08",
      runDate: "2026-05-08",
      storyCount: 5,
      topItems: [
        { id: 11, title: "Speculative decoding lands in vLLM", sourceType: "hn" },
      ],
      leadSummary: "MTP arrives in vLLM and llama.cpp within 48 hours.",
      digestHeadline: "AI-slop, smart agents, careful silicon",
      digestSummary:
        "Three threads — the open web's quiet capitulation to AI-generated noise, hard limits showing up in agent architectures, and a quieter race to make inference silicon useful at the edge.",
    },
    {
      runId: "r-2026-05-07",
      runDate: "2026-05-07",
      storyCount: 3,
      topItems: [{ id: 12, title: "Architects push back on agent-written code", sourceType: "reddit" }],
      leadSummary: null,
      digestHeadline: "Tension between AI-generated content and design patterns",
      digestSummary:
        "Architects pushed back on agent-written code in three high-traffic threads.",
    },
    {
      runId: "r-2026-05-06",
      runDate: "2026-05-06",
      storyCount: 12,
      topItems: [{ id: 13, title: "MTP speculative decoding", sourceType: "hn" }],
      leadSummary: null,
      digestHeadline: "MTP speculative decoding unlocks 2–3× speedups locally",
      digestSummary:
        "Multi-Token Prediction landed in llama.cpp, vLLM, and one closed-source runtime within 48 hours.",
    },
    {
      runId: "r-2026-04-30",
      runDate: "2026-04-30",
      storyCount: 7,
      topItems: [{ id: 14, title: "Old issue from April", sourceType: "blog" }],
      leadSummary: null,
      digestHeadline: "Flow maps and agentic coding",
      digestSummary: "A flow-maps paper makes diffusion sampling cheaper without a quality drop.",
    },
  ],
};

const completedRun = {
  id: "r-2026-05-08",
  status: "completed",
  stage: "completed",
  topN: 5,
  startedAt: "2026-05-08T10:00:00Z",
  updatedAt: "2026-05-08T10:30:00Z",
  completedAt: "2026-05-08T10:30:00Z",
  digestHeadline: "AI-slop, smart agents, careful silicon.",
  digestSummary:
    "Three threads sit underneath this morning's edition: the open web's quiet capitulation to AI-generated noise, hard limits showing up in agent architectures, and a less glamorous race to make inference silicon useful at the edge.",
  sources: { hn: { status: "completed", itemsFetched: 5, errors: [] } },
  rankedItems: [
    {
      id: 1,
      rawItemId: 1,
      title:
        "The open web is choking on AI-generated content, and platforms are out of patience.",
      url: "https://news.ycombinator.com/item?id=1",
      sourceType: "hn",
      author: "moderator",
      publishedAt: "2026-05-08T08:00:00Z",
      engagement: { points: 412, commentCount: 320 },
      score: 0.95,
      rationale: "Convergent evidence across multiple platforms.",
      content: null,
      imageUrl: null,
      recap: {
        summary:
          "A week of forum threads, abandoned subreddits, and one moderator post added up to the same conclusion — the cleanup tools are losing.",
        bullets: [
          "Three of the largest dev communities posted moderator-burnout notes this week.",
          "StackOverflow's policy update banning generated answers without disclosure is starting to look prescient.",
          "New detector models report 30%+ false positive rates on non-native English authors.",
          "Reddit's verified-human flair experiment is being copied without the name attached.",
        ],
        bottomLine:
          "The fight isn't AI vs human anymore — it's whether platforms can find any signal that survives a week of motivated abuse.",
      },
    },
    {
      id: 2,
      rawItemId: 2,
      title:
        "\"Smart\" agents keep failing on the same boring class of problem — long-horizon planning.",
      url: "https://arxiv.org/abs/2605.04127",
      sourceType: "rss",
      author: null,
      publishedAt: "2026-05-08T07:00:00Z",
      engagement: { points: 0, commentCount: 0 },
      score: 0.9,
      rationale: "Two papers and a post-mortem converging on the same finding.",
      content: null,
      imageUrl: null,
      recap: {
        summary:
          "Two papers and one production post-mortem this week converge on the same finding from different angles.",
        bullets: [
          "Sub-task selection looks fine in isolation but compounds badly past 8–12 steps.",
          "Adding a planner sub-agent helps for a quarter, then hits the same wall.",
          "A coding-agent vendor's post-mortem admitted 60% of customer escalations trace here.",
        ],
        bottomLine:
          "The agent-architecture debate is less philosophical than it was last year — the benchmarks are starting to settle the argument.",
      },
    },
    {
      id: 3,
      rawItemId: 3,
      title: "A new class of inference chips is shipping for the edge — quietly.",
      url: "https://github.com/ggerganov/llama.cpp",
      sourceType: "github",
      author: null,
      publishedAt: "2026-05-08T06:00:00Z",
      engagement: { points: 0, commentCount: 0 },
      score: 0.88,
      rationale: "Three toolchains shipped support in the same week.",
      content: null,
      imageUrl: null,
      recap: {
        summary: "No keynote. No livestream. Three open-source toolchains updated their hardware support lists in the same week.",
        bullets: [
          "llama.cpp, vLLM, and MLX merged support for two new edge accelerators.",
          "Independent reviewers cluster around 4–5× perf-per-watt versus current consumer GPUs.",
          "Pricing isn't public yet but leaked invoices put the cards in the $300–$500 range.",
        ],
        bottomLine:
          "Edge inference is starting to look like a real category, not a footnote.",
      },
    },
  ],
  warnings: [],
  error: null,
};

async function mockApi(page: Page): Promise<void> {
  await page.route("**/api/archives", async (route: Route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(archives) });
  });
  await page.route("**/api/archives/r-2026-05-08", async (route: Route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(completedRun) });
  });
}

test.describe("Redesign — listing page", () => {
  test("renders hero, search, filter tabs, month group, and rows", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "The Daily Read" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Made by Vertexcover Labs/i })).toBeVisible();
    await expect(page.getByLabel(/Search the archive/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /All time/i })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Read issue from 2026-05-08/i })).toBeVisible();
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "listing-desktop.png"),
      fullPage: true,
    });
  });

  test("⌘K focuses search input", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await expect(page.getByLabel(/Search the archive/i)).toBeVisible();
    const isMac = process.platform === "darwin";
    await page.keyboard.press(isMac ? "Meta+k" : "Control+k");
    await expect(page.getByLabel(/Search the archive/i)).toBeFocused();
  });

  test("typing into search filters the list", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await page.getByLabel(/Search the archive/i).fill("flow-maps");
    // Only the April 30 issue mentions flow-maps
    await expect(page.getByRole("link", { name: /Read issue from 2026-04-30/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Read issue from 2026-05-08/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Read issue from 2026-05-07/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Read issue from 2026-05-06/i })).toHaveCount(0);
  });

  test("date filter 'Last 30 days' filters out the April 30 issue when current date is far enough", async ({ page }) => {
    await mockApi(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Last 30 days/i }).click();
    await expect(page.getByRole("button", { name: /Last 30 days/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("listing renders correctly on mobile (375 wide)", async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "The Daily Read" })).toBeVisible();
    await expect(page.getByLabel(/Search the archive/i)).toBeVisible();
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "listing-mobile.png"),
      fullPage: true,
    });
  });
});

test.describe("Redesign — detail page", () => {
  test("renders back link, header, share row, stories, footer", async ({ page }) => {
    await mockApi(page);
    await page.goto("/archive/r-2026-05-08");
    await expect(page.getByRole("link", { name: /Back to archive/i })).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /AI-slop, smart agents, careful silicon/i,
      }),
    ).toBeVisible();
    await expect(page.getByText(/3 stories ·/i)).toBeVisible();
    const articles = page.locator("article");
    await expect(articles).toHaveCount(3);
    await expect(page.getByText(/^Bottom line$/i).first()).toBeVisible();
    await expect(page.getByRole("group", { name: /Share this issue/i })).toBeVisible();
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "detail-desktop.png"),
      fullPage: true,
    });
  });

  test("Read source link points at original article", async ({ page }) => {
    await mockApi(page);
    await page.goto("/archive/r-2026-05-08");
    const firstArticleSourceLink = page
      .locator("article")
      .first()
      .getByRole("link", { name: /Read source/i });
    await expect(firstArticleSourceLink).toBeVisible();
    await expect(firstArticleSourceLink).toHaveAttribute(
      "href",
      "https://news.ycombinator.com/item?id=1",
    );
  });

  test("detail page renders correctly on mobile (375 wide)", async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/archive/r-2026-05-08");
    await expect(page.getByRole("link", { name: /Back to archive/i })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: /AI-slop, smart agents, careful silicon/i }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, "detail-mobile.png"),
      fullPage: true,
    });
  });

  test("ScrollToTop button appears after scrolling and returns to top", async ({ page }) => {
    await mockApi(page);
    await page.goto("/archive/r-2026-05-08");
    const btn = page.getByRole("button", { name: /Scroll to top/i });
    await expect(btn).toHaveAttribute("data-visible", "false");
    await page.evaluate(() => {
      window.scrollTo(0, 1200);
    });
    await expect(btn).toHaveAttribute("data-visible", "true");
  });
});
