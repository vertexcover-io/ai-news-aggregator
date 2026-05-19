// Probe: dump the exact shape of `generateObject(...).usage` and `.providerMetadata`
// against the installed @ai-sdk/anthropic + ai versions in this repo.
//
// Run from the pipeline package so the workspace deps resolve:
//   cd packages/pipeline
//   ANTHROPIC_API_KEY=... pnpm tsx ../../docs/spec/admin-pipeline-cost-analysis/probes/usage-shape.mjs

import "dotenv/config";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const result = await generateObject({
  model: anthropic("claude-haiku-4-5-20251001"),
  schema: z.object({ answer: z.string() }),
  prompt: 'Answer in JSON: { "answer": "ok" }. Use exactly that word, nothing else.',
  temperature: 0,
});

console.log("=== object ===");
console.log(JSON.stringify(result.object, null, 2));

console.log("=== usage (keys) ===");
console.log(Object.keys(result.usage ?? {}));

console.log("=== usage (json) ===");
console.log(JSON.stringify(result.usage, null, 2));

console.log("=== providerMetadata (json) ===");
console.log(JSON.stringify(result.providerMetadata, null, 2));

console.log("=== response (keys) ===");
console.log(Object.keys(result.response ?? {}));
