import type { InvariantContext, InvariantResult } from "./types.js";
import { checkPackageJsonPinning } from "./package-json-pinning.js";
import { checkAiSdkAlignment } from "./ai-sdk-alignment.js";
import { checkVitestConfigExcluded } from "./vitest-config-excluded.js";
import { checkNoDockerReferences } from "./no-docker-references.js";

export function runAllInvariants(
  context: InvariantContext,
): InvariantResult {
  return {
    violations: [
      ...checkPackageJsonPinning(context).violations,
      ...checkAiSdkAlignment(context).violations,
      ...checkVitestConfigExcluded(context).violations,
      ...checkNoDockerReferences(context).violations,
    ],
  };
}

export type { InvariantContext, InvariantResult, Violation } from "./types.js";
