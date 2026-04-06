import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createLogger } from "@newsletter/shared/logger";
import type { WebSourceSelectors } from "@pipeline/types.js";

const logger = createLogger("selector-cache");

interface CacheEntry {
  selectors: WebSourceSelectors;
  derivedAt: string;
  lastVerifiedAt: string;
}

interface CacheData {
  entries: Record<string, CacheEntry>;
}

export interface SelectorCache {
  get(url: string): WebSourceSelectors | null;
  set(url: string, selectors: WebSourceSelectors): void;
  invalidate(url: string): void;
  save(): void;
}

function loadCacheData(filePath: string): CacheData {
  if (!existsSync(filePath)) {
    return { entries: {} };
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as CacheData;
  } catch {
    logger.warn({ filePath }, "invalid JSON in selector cache file, starting with empty cache");
    return { entries: {} };
  }
}

export function createSelectorCache(filePath: string): SelectorCache {
  const data = loadCacheData(filePath);

  return {
    get(url: string): WebSourceSelectors | null {
      const entry = data.entries[url] as CacheEntry | undefined;
      return entry ? entry.selectors : null;
    },

    set(url: string, selectors: WebSourceSelectors): void {
      const now = new Date().toISOString();
      data.entries[url] = {
        selectors,
        derivedAt: now,
        lastVerifiedAt: now,
      };
      this.save();
    },

    invalidate(url: string): void {
      const { [url]: _, ...rest } = data.entries;
      data.entries = rest;
      this.save();
    },

    save(): void {
      writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    },
  };
}
