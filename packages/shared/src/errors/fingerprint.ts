/**
 * Deterministic error fingerprinting for occurrence dedup (design §5).
 *
 * `fingerprint = sha1(category + source + normalized_message + top_app_frame)`,
 * truncated. The same logical error always hashes to the same value so PostHog
 * grouping (`$exception_fingerprint`) and our `error_incidents` row agree, and
 * ids/timestamps/urls in the message don't fragment one bug into many.
 */
import { createHash } from "node:crypto";

/** Strip volatile tokens (urls, uuids, numbers, hex) so the message is stable across occurrences. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * First stack frame inside one of our packages (ignoring node_modules). Used both
 * for `code-bug` detection and as a stable fingerprint component. Matches paths
 * like `/packages/pipeline/src/...` or bundled `/dist/...` under our package dirs.
 */
export function topAppFrame(stack: string | undefined): string | undefined {
  if (stack === undefined || stack === "") return undefined;
  for (const line of stack.split("\n")) {
    if (line.includes("node_modules")) continue;
    const match = /\/packages\/(?:api|pipeline|shared|web)\/[^\s):]+/.exec(line);
    if (match !== null) return match[0];
  }
  return undefined;
}

/** Compute the short, stable fingerprint for an error. */
export function computeFingerprint(input: {
  category: string;
  source: string;
  message: string;
  stack?: string;
}): string {
  const normalized = normalizeMessage(input.message);
  const frame = topAppFrame(input.stack) ?? "";
  return createHash("sha1")
    .update(`${input.category}\n${input.source}\n${normalized}\n${frame}`)
    .digest("hex")
    .slice(0, 12);
}
