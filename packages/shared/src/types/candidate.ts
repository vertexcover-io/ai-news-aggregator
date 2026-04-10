import type { SourceType } from "../db/schema.js";
import type { RawItemComment, RawItemEngagement } from "./index.js";


export interface Candidate {
  id: number;
  title: string;
  url: string;
  sourceType: SourceType;
  author: string | null;
  publishedAt: Date | null;
  engagement: RawItemEngagement;
  content: string | null;
  comments: RawItemComment[];
}
