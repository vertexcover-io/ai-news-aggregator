import { SOURCE_TYPE_SECTION_LABELS } from "@newsletter/shared/constants";

const SOURCE_LABELS = SOURCE_TYPE_SECTION_LABELS as Record<string, string>;

export function sourceTypeLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? sourceType;
}
