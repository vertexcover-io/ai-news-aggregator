import type { PublicMustReadEntry } from "@shared/types/must-read.js";
import type { RecapContent } from "@shared/types/index.js";
import type {
  IndexInput,
  IndexFullInput,
  IssueFull,
  IssueMeta,
  LlmTxtOpts,
  LlmTxtStory,
} from "./types.js";

export function absoluteUrl(baseUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = baseUrl.replace(/\/+$/, "");
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${path}`;
}

function issuePath(runId: string): string {
  return `/archive/${runId}`;
}

function renderRecap(recap: RecapContent): string[] {
  const lines: string[] = [];
  if (recap.summary) lines.push(recap.summary);
  for (const bullet of recap.bullets) lines.push(`- ${bullet}`);
  if (recap.bottomLine) lines.push(`**Bottom line:** ${recap.bottomLine}`);
  return lines;
}

function renderStory(story: LlmTxtStory): string {
  const lines: string[] = [`### [${story.title}](${story.url})`];
  if (story.recap) lines.push(...renderRecap(story.recap));
  return lines.join("\n");
}

export function renderIssueLlmTxt(
  issue: IssueMeta,
  stories: LlmTxtStory[],
  _opts: LlmTxtOpts,
): string {
  const headline = issue.digestHeadline ?? `AI News — ${issue.issueDate}`;
  const blocks: string[] = [`# ${headline}`];
  if (issue.digestSummary) blocks.push(`> ${issue.digestSummary}`);
  blocks.push(`Issue date: ${issue.issueDate}`);
  if (stories.length === 0) {
    blocks.push("No stories in this issue.");
  } else {
    blocks.push("## Stories");
    for (const story of stories) blocks.push(renderStory(story));
  }
  return blocks.join("\n\n") + "\n";
}

export function renderCanonLlmTxt(
  entries: PublicMustReadEntry[],
  _opts: LlmTxtOpts,
): string {
  const blocks: string[] = [
    "# Canon — must-read reading list",
    "> A curated, canonical reading list of foundational AI writing.",
  ];
  if (entries.length === 0) {
    blocks.push("None yet.");
  } else {
    blocks.push(entries.map((e) => renderCanonEntry(e)).join("\n"));
  }
  return blocks.join("\n\n") + "\n";
}

function renderCanonEntry(e: PublicMustReadEntry): string {
  const byline = [e.author, e.year ? String(e.year) : null]
    .filter(Boolean)
    .join(", ");
  const meta = byline ? ` (${byline})` : "";
  const annotation = e.annotation ? ` — ${e.annotation}` : "";
  return `- [${e.title}](${e.url})${meta}${annotation}`;
}

function renderIssuesSection(input: IndexInput): string {
  const lines: string[] = ["## Issues"];
  if (input.issues.length === 0) {
    lines.push("No published issues yet.");
    return lines.join("\n");
  }
  for (const issue of input.issues) {
    const label = issue.digestHeadline
      ? `${issue.issueDate} — ${issue.digestHeadline}`
      : issue.issueDate;
    const url = absoluteUrl(input.opts.baseUrl, issuePath(issue.runId));
    lines.push(`- [${label}](${url})`);
  }
  return lines.join("\n");
}

const CANON_PATH = "/must-read";

function renderCanonSection(input: IndexInput): string {
  const url = absoluteUrl(input.opts.baseUrl, CANON_PATH);
  const lines: string[] = [
    "## Canon — must-read reading list",
    `A curated, canonical reading list of foundational AI writing. See [the full canon](${url}).`,
  ];
  if (input.canon.length === 0) {
    lines.push("None yet.");
    return lines.join("\n");
  }
  for (const e of input.canon) lines.push(renderCanonEntry(e));
  return lines.join("\n");
}

function renderPagesSections(input: IndexInput): string[] {
  return input.staticPages.map((page) => {
    const url = absoluteUrl(input.opts.baseUrl, page.path);
    return [`## ${page.title}`, `- [${page.title}](${url}) — ${page.description}`].join(
      "\n",
    );
  });
}

export function renderIndexLlmsTxt(input: IndexInput): string {
  const blocks: string[] = [`# ${input.site.title}`, `> ${input.site.summary}`];
  blocks.push(renderIssuesSection(input));
  blocks.push(renderCanonSection(input));
  blocks.push(...renderPagesSections(input));
  return blocks.join("\n\n") + "\n";
}

export function renderIndexLlmsFullTxt(input: IndexFullInput): string {
  const blocks: string[] = [`# ${input.site.title}`, `> ${input.site.summary}`];

  const issuesBlock: string[] = ["## Issues"];
  if (input.issuesFull.length === 0) {
    issuesBlock.push("No published issues yet.");
  } else {
    for (const full of input.issuesFull) {
      issuesBlock.push(renderInlineIssue(full, input.opts));
    }
  }
  blocks.push(issuesBlock.join("\n\n"));

  blocks.push(renderCanonSection(input));
  blocks.push(...renderPagesSections(input));
  return blocks.join("\n\n") + "\n";
}

function renderInlineIssue(full: IssueFull, opts: LlmTxtOpts): string {
  const url = absoluteUrl(opts.baseUrl, issuePath(full.meta.runId));
  const headline = full.meta.digestHeadline ?? `AI News — ${full.meta.issueDate}`;
  const lines: string[] = [`### [${headline}](${url})`, `Issue date: ${full.meta.issueDate}`];
  if (full.meta.digestSummary) lines.push(`> ${full.meta.digestSummary}`);
  for (const story of full.stories) lines.push(renderStory(story));
  return lines.join("\n\n");
}
