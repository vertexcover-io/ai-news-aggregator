import type { ArchiveListItem } from "./archive.js";
import type { PublicMustReadEntry } from "./must-read.js";

export interface HomePagePayload {
  todaysIssue: ArchiveListItem | null;
  featuredCanon: PublicMustReadEntry | null;
  recentIssues: ArchiveListItem[];
}
