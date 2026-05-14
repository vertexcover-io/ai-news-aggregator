import type { EnrichedLinkContent } from "@newsletter/shared";

export function createEnrichmentCache(): Map<string, EnrichedLinkContent> {
  return new Map();
}
