import { config } from "dotenv";
import { resolve } from "node:path";
import type { Candidate } from "@newsletter/shared";
import { DEFAULT_RANKING_PROMPT } from "@newsletter/shared/constants";
import { rankCandidates } from "@pipeline/processors/rank.js";

config({ path: resolve(import.meta.dirname, "../../../../.env") });

type EvalCategory = "builder" | "tempting";

type EvalCandidate = Candidate & {
  readonly category: EvalCategory;
  readonly disallowTop3?: true;
  readonly keyBuilder?: true;
  readonly fundingOnly?: true;
};

const NOW = new Date("2026-05-15T12:00:00Z");
const TOP_N = 8;

const AXES = [
  "developer-relevance",
  "builder-impact",
  "agentic-systems-relevance",
  "evidence-quality",
  "signal-vs-hype",
] as const;

const EVAL_CANDIDATES: ReadonlyArray<EvalCandidate> = [
  makeCandidate({
    id: 1,
    title: "Claude Code adds traceable subagents for CI debugging",
    url: "https://example.com/claude-code-subagents",
    category: "builder",
    keyBuilder: true,
    content:
      "Anthropic released a Claude Code update with traceable subagents, tool-call timelines, and CI log inspection. The release notes show examples for delegating failing test investigation to separate agents, collecting tool traces, and feeding the result back into the main coding session. The workflow is aimed at teams operating coding agents in real repositories.",
  }),
  makeCandidate({
    id: 2,
    title: "Open-source agent eval suite reproduces SWE-bench triage",
    url: "https://example.com/agent-evals",
    category: "builder",
    keyBuilder: true,
    content:
      "A new open-source eval framework ships fixtures for coding-agent regression tests, reproducible SWE-bench-style issue triage, and pass/fail traces for tool calls. The project includes a methodology document, seed data, and examples for measuring whether an agent actually fixed a bug rather than just passing a narrow test.",
  }),
  makeCandidate({
    id: 3,
    title: "LangGraph adds durable agent orchestration checkpoints",
    url: "https://example.com/langgraph-checkpoints",
    category: "builder",
    keyBuilder: true,
    content:
      "LangGraph introduced durable checkpoints, retry boundaries, and state inspection for long-running agent workflows. The release focuses on reliability failures in multi-step agents, including partial tool failure, human review, and resuming from a saved state without restarting the entire workflow.",
  }),
  makeCandidate({
    id: 4,
    title: "Model API adds native structured tool-result validation",
    url: "https://example.com/model-api-tool-validation",
    category: "builder",
    content:
      "A frontier model API now validates tool results against declared schemas before continuing generation. The change affects agent frameworks that rely on JSON mode, retries, and tool-call repair loops. The API docs include migration notes, failure modes, and examples for typed tool outputs.",
  }),
  makeCandidate({
    id: 5,
    title: "Agent observability startup ships production replay debugger",
    url: "https://example.com/agent-observability",
    category: "builder",
    content:
      "An AI observability platform launched a replay debugger for production agents. It captures prompts, tool calls, latency, token usage, retrieved context, and user-visible outcomes, then lets teams compare failures against successful traces. The announcement includes customer examples from support automation and internal developer tooling.",
  }),
  makeCandidate({
    id: 6,
    title: "Major AI lab raises $8B at $90B valuation",
    url: "https://example.com/lab-funding",
    category: "tempting",
    disallowTop3: true,
    fundingOnly: true,
    content:
      "A major AI lab raised $8 billion at a $90 billion valuation. The story names the investors and describes market momentum, but provides no new product, model, API, benchmark, infrastructure, or developer workflow details beyond the financing event.",
  }),
  makeCandidate({
    id: 7,
    title: "Viral avatar app tops consumer AI charts",
    url: "https://example.com/avatar-app",
    category: "tempting",
    disallowTop3: true,
    content:
      "A consumer AI avatar app became the top download on mobile app stores after creators used it for stylized videos. The article focuses on growth, social sharing, and celebrity posts. It does not describe new model capabilities or implications for AI development workflows.",
  }),
  makeCandidate({
    id: 8,
    title: "Senate hearing debates AI liability rules",
    url: "https://example.com/ai-liability-hearing",
    category: "tempting",
    content:
      "Lawmakers held a hearing about liability for AI-generated decisions. The testimony was broad and mostly political, with no concrete implementation deadline, technical compliance mechanism, or direct guidance for teams building agentic software systems.",
  }),
  makeCandidate({
    id: 9,
    title: "Top 20 prompts for instant AI productivity",
    url: "https://example.com/top-prompts",
    category: "tempting",
    disallowTop3: true,
    content:
      "A blog post lists twenty generic prompts for writing emails, summarizing meetings, and brainstorming content. The examples are consumer productivity tips with no engineering workflow, eval methodology, tool integration, or operational lesson.",
  }),
  makeCandidate({
    id: 10,
    title: "Developer tunes home GPU rig for local models",
    url: "https://example.com/home-gpu-rig",
    category: "tempting",
    content:
      "An individual developer describes undervolting a consumer GPU and tweaking drivers to run a quantized model at home. The post is detailed but mostly hardware-specific and does not generalize to production AI engineering or agentic workflows.",
  }),
  makeCandidate({
    id: 11,
    title: "New benchmark leaderboard claims frontier model upset",
    url: "https://example.com/unclear-benchmark",
    category: "tempting",
    content:
      "A benchmark leaderboard claims a small model beats several frontier models, but the methodology is unclear, test contamination is not addressed, and no task-level examples or reproducible scripts are provided.",
  }),
  makeCandidate({
    id: 12,
    title: "Newsletter summarizes yesterday's agent eval release",
    url: "https://example.com/eval-summary",
    category: "tempting",
    content:
      "A secondary newsletter summarizes the open-source agent eval suite already covered by the original project. It adds a short opinion paragraph but no new details, examples, methodology, or engineering implications beyond the source release.",
  }),
];

function makeCandidate(input: {
  readonly id: number;
  readonly title: string;
  readonly url: string;
  readonly category: EvalCategory;
  readonly content: string;
  readonly disallowTop3?: true;
  readonly keyBuilder?: true;
  readonly fundingOnly?: true;
}): EvalCandidate {
  return {
    id: input.id,
    title: input.title,
    url: input.url,
    sourceType: "blog",
    author: "eval-fixture",
    publishedAt: NOW,
    engagement: { points: 10, commentCount: 1 },
    content: input.content,
    comments: [],
    category: input.category,
    ...(input.disallowTop3 ? { disallowTop3: true } : {}),
    ...(input.keyBuilder ? { keyBuilder: true } : {}),
    ...(input.fundingOnly ? { fundingOnly: true } : {}),
  };
}

function loadInlineBodies(
  candidates: Candidate[],
): Promise<Map<number, string | null>> {
  return Promise.resolve(new Map(candidates.map((candidate) => [candidate.id, candidate.content])));
}

function hasAxis(rationale: string): boolean {
  const normalized = rationale.toLowerCase();
  return AXES.some((axis) => normalized.includes(axis));
}

function evaluateResult(rankedIds: ReadonlyArray<number>, rationales: Map<number, string>): string[] {
  const failures: string[] = [];
  const candidateById = new Map(EVAL_CANDIDATES.map((candidate) => [candidate.id, candidate]));
  const top3 = rankedIds.slice(0, 3).map((id) => candidateById.get(id));
  const top8 = rankedIds.slice(0, TOP_N).map((id) => candidateById.get(id));
  const builderTop8Count = top8.filter((candidate) => candidate?.category === "builder").length;

  if (builderTop8Count < 5) {
    failures.push(`expected at least 5 builder stories in top 8, got ${builderTop8Count}`);
  }

  const bannedTop3 = top3.find((candidate) => candidate?.disallowTop3 === true);
  if (bannedTop3 !== undefined) {
    failures.push(`expected no banned tempting story in top 3, got #${bannedTop3.id}: ${bannedTop3.title}`);
  }

  const leadId = rankedIds[0];
  const leadRationale = leadId === undefined ? undefined : rationales.get(leadId);
  if (leadRationale === undefined || !hasAxis(leadRationale)) {
    failures.push("expected rank-1 rationale to mention one of the new axes");
  }

  const rankById = new Map(rankedIds.map((id, index) => [id, index + 1]));
  const fundingRank = EVAL_CANDIDATES
    .filter((candidate) => candidate.fundingOnly === true)
    .map((candidate) => rankById.get(candidate.id))
    .find((rank) => rank !== undefined);
  const bestKeyBuilderRank = Math.min(
    ...EVAL_CANDIDATES
      .filter((candidate) => candidate.keyBuilder === true)
      .map((candidate) => rankById.get(candidate.id))
      .filter((rank): rank is number => rank !== undefined),
  );

  if (fundingRank === undefined) {
    failures.push("expected funding-only story to appear somewhere in the ranked output for comparison");
  } else if (!Number.isFinite(bestKeyBuilderRank) || bestKeyBuilderRank >= fundingRank) {
    failures.push("expected the best coding-agent/eval/orchestration story to outrank the funding-only story");
  }

  return failures;
}

async function main(): Promise<number> {
  if (process.env.RUN_LIVE_RANK_EVAL !== "1") {
    console.log("Skipping live rank eval. Set RUN_LIVE_RANK_EVAL=1 to spend one Anthropic ranking call.");
    return 0;
  }

  const result = await rankCandidates([...EVAL_CANDIDATES], {
    topN: TOP_N,
    systemPrompt: DEFAULT_RANKING_PROMPT,
    now: NOW,
    loadBodies: loadInlineBodies,
  });

  const rationales = new Map(
    result.rankedItems.map((item) => [item.rawItemId, item.rationale]),
  );
  const rankedIds = result.rankedItems.map((item) => item.rawItemId);

  console.log("Rank eval result:");
  for (const [index, item] of result.rankedItems.entries()) {
    const source = EVAL_CANDIDATES.find((candidate) => candidate.id === item.rawItemId);
    console.log(`${index + 1}. #${item.rawItemId} score=${item.score.toFixed(2)} ${source?.title ?? "(unknown)"}`);
    console.log(`   ${item.rationale}`);
  }

  const failures = evaluateResult(rankedIds, rationales);
  if (failures.length === 0) {
    console.log("Rank eval passed.");
    return 0;
  }

  console.error("Rank eval failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  return 1;
}

process.exitCode = await main();
