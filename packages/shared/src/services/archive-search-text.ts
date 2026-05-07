import type { SourceType } from "../db/schema.js";
import type { RankedItemRef } from "../types/run.js";
import type { RawItemMetadata } from "../types/index.js";

export interface ArchiveSearchRawItem {
  id: number;
  title: string;
  url: string;
  sourceType: SourceType;
  author: string | null;
  metadata: RawItemMetadata;
}

export interface ArchiveSearchInput {
  digestHeadline: string | null;
  digestSummary: string | null;
  rankedItems: RankedItemRef[];
  rawItemsById: Map<number, ArchiveSearchRawItem>;
}

const MAX_TEXT_BYTES = 64 * 1024;

export function serializeArchiveSearchText(input: ArchiveSearchInput): string {
  const parts: string[] = [];
  if (input.digestHeadline) parts.push(input.digestHeadline);
  if (input.digestSummary) parts.push(input.digestSummary);

  for (const ref of input.rankedItems) {
    const raw = input.rawItemsById.get(ref.rawItemId);
    if (!raw) continue;
    const recap = raw.metadata.recap;
    const summary = ref.summary ?? recap?.summary ?? "";
    const bullets = (ref.bullets ?? recap?.bullets ?? []).join("\n");
    const bottomLine = ref.bottomLine ?? recap?.bottomLine ?? "";
    const host = safeHost(raw.url);
    parts.push(
      [raw.title, host, raw.sourceType, raw.author ?? "", summary, bullets, bottomLine]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const out = parts.join("\n\n");
  if (Buffer.byteLength(out, "utf8") <= MAX_TEXT_BYTES) return out;
  return Buffer.from(out, "utf8").subarray(0, MAX_TEXT_BYTES).toString("utf8");
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
