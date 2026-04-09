#!/usr/bin/env tsx
import { runAllInvariants } from "./invariants/index.js";

function main(): number {
  const result = runAllInvariants({ cwd: process.cwd() });
  if (result.violations.length === 0) {
    console.log("\u2713 All repo invariants pass.");
    return 0;
  }
  console.error(`\u2717 ${result.violations.length} invariant violation(s):`);
  for (const v of result.violations) {
    const loc = v.line !== undefined ? `${v.file}:${v.line}` : v.file;
    console.error(`  [${v.invariant}] ${loc} \u2014 ${v.message}`);
  }
  return 1;
}

process.exit(main());
