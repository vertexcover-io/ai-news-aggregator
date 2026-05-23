import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RankedItemRef } from "@newsletter/shared";

export interface CachedResponseUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface CachedResponse {
  rankedItems: RankedItemRef[];
  usage: CachedResponseUsage;
  model: string;
  savedAt: string;
  promptHash: string;
}

export interface EvalCacheOptions {
  bypassCache?: boolean;
}

export class EvalCache {
  readonly rootDir: string;
  readonly bypassCache: boolean;

  constructor(rootDir: string, opts: EvalCacheOptions = {}) {
    this.rootDir = rootDir;
    this.bypassCache = opts.bypassCache ?? false;
  }

  key(fixtureId: string, prompt: string, model: string): string {
    return createHash("sha256")
      .update(`${prompt}:${fixtureId}:${model}`)
      .digest("hex")
      .slice(0, 16);
  }

  private filePath(fixtureId: string, prompt: string, model: string): string {
    return join(this.rootDir, `${this.key(fixtureId, prompt, model)}.json`);
  }

  async get(
    fixtureId: string,
    prompt: string,
    model: string,
  ): Promise<CachedResponse | null> {
    if (this.bypassCache) return null;
    const path = this.filePath(fixtureId, prompt, model);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      return null;
    }
    try {
      return JSON.parse(text) as CachedResponse;
    } catch {
      return null;
    }
  }

  async set(
    fixtureId: string,
    prompt: string,
    model: string,
    value: CachedResponse,
  ): Promise<void> {
    if (this.bypassCache) return;
    const path = this.filePath(fixtureId, prompt, model);
    await mkdir(dirname(path), { recursive: true });
    const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, JSON.stringify(value, null, 2), "utf8");
    await rename(tmpPath, path);
  }
}
