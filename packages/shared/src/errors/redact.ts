/**
 * Secret redaction — MANDATORY before any error context leaves the process
 * (Slack, GitHub, persisted incident rows). Tokens and keys routinely appear in
 * error messages ("invalid token sk-...", auth headers echoed in fetch errors),
 * and those payloads cross trust boundaries. Better to over-redact than leak.
 */

interface Rule {
  re: RegExp;
  /** Replacement; `$1` keeps a leading label/prefix so the shape stays readable. */
  replace: string;
}

const RULES: readonly Rule[] = [
  // Authorization: Bearer <token>
  { re: /(bearer\s+)[A-Za-z0-9._-]+/gi, replace: "$1<redacted>" },
  // Provider key prefixes: sk-..., pk-..., rk-... (OpenAI/Stripe-style)
  { re: /\b(?:sk|pk|rk)-[A-Za-z0-9]{8,}\b/g, replace: "<redacted>" },
  // GitHub tokens: ghp_, gho_, ghs_, ghu_, github_pat_
  { re: /\bgh[posu]_[A-Za-z0-9]{20,}\b/g, replace: "<redacted>" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replace: "<redacted>" },
  // Slack tokens: xoxb-, xoxa-, xoxp-, xoxr-, xoxs-
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi, replace: "<redacted>" },
  // JWTs
  { re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replace: "<redacted>" },
  // key=value / key: value for sensitive keys (query strings, JSON, env dumps)
  {
    re: /(\b(?:api[_-]?key|apikey|token|secret|password|passwd|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)\b\s*[:=]\s*)["']?[^"'\s,&}]+/gi,
    replace: "$1<redacted>",
  },
];

/** Redact known secret shapes from a string. Returns the input unchanged when empty. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, rule.replace);
  }
  return out;
}
