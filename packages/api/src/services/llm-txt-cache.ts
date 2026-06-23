import type IORedis from "ioredis";

export interface LlmTxtCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

const KEY_PREFIX = "llm-txt:";
const TTL_SECONDS = 86_400; // 24h backstop; the version-key handles real invalidation

type RedisLike = Pick<IORedis, "get" | "set">;

export function createRedisLlmTxtCache(redis: RedisLike): LlmTxtCache {
  return {
    async get(key: string): Promise<string | null> {
      return redis.get(KEY_PREFIX + key);
    },
    async set(key: string, value: string): Promise<void> {
      await redis.set(KEY_PREFIX + key, value, "EX", TTL_SECONDS);
    },
  };
}

/**
 * Content signature for an llm.txt variant. The cache entry stays valid until
 * the underlying data changes — a new published issue, a canon edit, or a
 * different issue count all change the signature, forcing one regeneration.
 */
export function llmTxtVersionKey(input: {
  variant: "index" | "full" | "issue";
  baseUrl: string;
  issueSignatures: string[];
  canonSignatures: string[];
  scope?: string;
}): string {
  const parts = [
    input.variant,
    input.baseUrl,
    input.scope ?? "",
    `i:${input.issueSignatures.length}:${input.issueSignatures.join(",")}`,
    `c:${input.canonSignatures.length}:${input.canonSignatures.join(",")}`,
  ];
  return parts.join("|");
}
