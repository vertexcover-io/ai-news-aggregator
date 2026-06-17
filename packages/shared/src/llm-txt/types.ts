import type { PublicMustReadEntry } from "@shared/types/must-read.js";
import type { RecapContent } from "@shared/types/index.js";

export interface LlmTxtOpts {
  baseUrl: string;
}

export interface IssueMeta {
  runId: string;
  issueDate: string;
  digestHeadline: string | null;
  digestSummary: string | null;
}

export interface LlmTxtStory {
  title: string;
  url: string;
  recap: RecapContent | null;
}

export interface IssueIndexEntry {
  runId: string;
  issueDate: string;
  digestHeadline: string | null;
}

export interface IssueFull {
  meta: IssueMeta;
  stories: LlmTxtStory[];
}

export interface LlmTxtStaticPage {
  title: string;
  path: string;
  description: string;
}

export interface LlmTxtSite {
  title: string;
  summary: string;
}

export interface IndexInput {
  site: LlmTxtSite;
  issues: IssueIndexEntry[];
  canon: PublicMustReadEntry[];
  staticPages: LlmTxtStaticPage[];
  opts: LlmTxtOpts;
}

export interface IndexFullInput extends IndexInput {
  issuesFull: IssueFull[];
}
