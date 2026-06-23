import {
  renderIndexLlmsTxt,
  renderIndexLlmsFullTxt,
  renderIssueLlmTxt,
  renderCanonLlmTxt,
  LLM_TXT_SITE,
  LLM_TXT_STATIC_PAGES,
  type IssueFull,
  type IssueIndexEntry,
} from "@newsletter/shared/llm-txt";
import type { PublicMustReadEntry } from "@newsletter/shared";

export interface LlmTxtSnapshotData {
  baseUrl: string;
  issues: IssueFull[];
  canon: PublicMustReadEntry[];
}

export interface LlmTxtIssueFile {
  fileName: string;
  content: string;
}

export interface LlmTxtSnapshot {
  index: string;
  indexFull: string;
  canon: string;
  issueFiles: LlmTxtIssueFile[];
}

function issueFileName(issueDate: string, runId: string): string {
  return `${issueDate}-${runId}.llm.txt`;
}

export function buildLlmTxtSnapshot(data: LlmTxtSnapshotData): LlmTxtSnapshot {
  const opts = { baseUrl: data.baseUrl };
  const indexEntries: IssueIndexEntry[] = data.issues.map((i) => ({
    runId: i.meta.runId,
    issueDate: i.meta.issueDate,
    digestHeadline: i.meta.digestHeadline,
  }));

  const index = renderIndexLlmsTxt({
    site: LLM_TXT_SITE,
    issues: indexEntries,
    canon: data.canon,
    staticPages: LLM_TXT_STATIC_PAGES,
    opts,
  });

  const indexFull = renderIndexLlmsFullTxt({
    site: LLM_TXT_SITE,
    issues: indexEntries,
    canon: data.canon,
    staticPages: LLM_TXT_STATIC_PAGES,
    opts,
    issuesFull: data.issues,
  });

  const canon = renderCanonLlmTxt(data.canon, opts);

  const issueFiles: LlmTxtIssueFile[] = data.issues.map((i) => ({
    fileName: issueFileName(i.meta.issueDate, i.meta.runId),
    content: renderIssueLlmTxt(i.meta, i.stories, opts),
  }));

  return { index, indexFull, canon, issueFiles };
}
