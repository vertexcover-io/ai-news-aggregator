export const SOURCE_NEUTRALITY_RULE =
  "Blog posts have no comments by source design. Do not penalize items that lack discussion. Use comments as extra context when present, never as a scoring requirement.";

export const DEFAULT_RANKING_WORKFLOW = `The reader is a software developer, tech lead, engineering manager, or founder who works with developers. They care about AI-assisted software development, coding agents, agentic AI tooling, evaluations, observability, infrastructure, reliability, and practical engineering workflows. They open this digest to find stories they can use themselves or share with their teams.

This newsletter should feel opinionated. It should surface AI news that helps developers and engineering teams understand what to build, test, automate, deploy, manage, or watch next. Prefer stories with practical consequences for software teams over broad AI-world awareness. Direct developer-tool, coding-agent, AI infrastructure, eval, observability, reliability, and production workflow stories should beat broad governance, policy, market, or research-awareness stories unless those stories clearly change how engineering teams build, review, ship, or operate software.

Boost primary-source releases and practical reports about coding agents, agent orchestration, eval frameworks, benchmark methodology, tool APIs, model behavior that affects tool use or structured outputs, AI infra, workflow automation, observability, reliability, incident/debugging loops, team adoption patterns, and hard-won engineering lessons. If an official title and URL clearly identify a coding-agent or developer-tool workflow release, treat that as a strong Developer-relevance signal even when engagement is low. Strong posts from builders shipping or operating these systems can outrank larger but less relevant industry news.

For the top 3, prefer direct agent/developer-tool workflow changes, production agent runtime controls, and AI-assisted coding governance that teams can act on immediately. Official primary-source coding-agent or developer-tool releases should usually beat hardware-specific CI runbooks and general inference benchmarks, even when those infra stories have stronger methodology. Do not let Evidence-quality alone push general infra benchmarks, hardware CI runbooks, academic publishing policy, or quota-only announcements above direct coding-agent, orchestration, runtime-governance, or developer-tool workflow stories.

Downrank generic AI hype, consumer novelty apps, funding-only stories, policy drama without a clear builder consequence, broad academic-publishing governance, quota-only announcements, prompt-listicles, vague thought leadership, broad leaderboard posts with weak methodology, and personal tinkering or homelab posts that do not generalize to real AI development workflows. Academic publishing policy, AI liability debate, research-governance stories, and pure usage-limit changes belong below concrete developer tools, infra runbooks, evals, agent operations, and AI-assisted coding workflow changes unless they directly change engineering-team practice.

When choosing between otherwise credible items, use this priority order:
1. Highest: primary-source developer tooling and coding-agent workflow changes.
2. Next: production agent operations, runtime governance, observability, cost controls, reliability, evals, CI, debugging, state, and deployment patterns.
3. Next: infrastructure benchmarks or runbooks with methodology and actionable recommendations, especially when they affect agent serving, evals, reliability, or deployment.
4. Next: team governance for AI-assisted coding that changes review, contribution, or release practice.
5. Lowest: broad strategy, policy, research-awareness, quota, or market stories after the practical builder stories are covered.

Do not use the priority labels above as rationale axes. Rationale text must still use at least one exact axis name from the five-axis list.

Score each candidate 0-100 on five axes, all viewed through that developer-and-engineering-team lens:
- Developer-relevance — does this matter to developers, tech leads, or engineering managers working with AI-assisted software development and developer tooling.
- Builder-impact — will this change how serious teams build, evaluate, deploy, observe, debug, manage, or operate AI-assisted software systems.
- Agentic-systems-relevance — does this directly affect agents, tool use, orchestration, memory, evals, reliability, workflow automation, or developer-facing AI systems.
- Evidence-quality — is there concrete substance: code, release notes, reproducible evals, benchmarks with methodology, user evidence, architecture detail, or a specific technical claim.
- Signal-vs-hype — is this a substantive development the reader would want to know happened, or marketing, speculation, listicles, empty announcements, or attention bait dressed up as news.

Source neutrality rule: ${SOURCE_NEUTRALITY_RULE}

Each rationale must name the driving axis so the reader can see why the item was ranked where it was. Use the exact axis names above in rationales.`;

export function resolveRankingWorkflow(raw: string): string {
  const trimmed = raw.trim();
  return trimmed === "" ? DEFAULT_RANKING_WORKFLOW : trimmed;
}
