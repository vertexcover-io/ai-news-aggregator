/**
 * Public entry for cross-package consumers (e.g. @newsletter/api) that need
 * the eval pipeline primitives without booting BullMQ workers (which the
 * main `index.ts` does as a side effect at import time).
 */
export {
  runEval,
  type RunEvalArgs,
  type RunEvalCost,
  type RunEvalOutput,
} from "@pipeline/eval/index.js";

export {
  listFixtures,
  readFixture,
  writeFixture,
  readGroundTruth,
  writeGroundTruth,
} from "@pipeline/eval/fixture-io.js";

export { EvalCache } from "@pipeline/eval/cache.js";

export {
  createManualFixture,
  type CreateManualFixtureOptions,
  type CreateManualFixtureDeps,
  type CreateManualFixtureResult,
} from "@pipeline/eval/manual-fixture.js";

export {
  buildCalendarFixture,
  runModeB,
  type CalendarPoolItem,
  type ModeBRunArgs,
  type ModeBResult,
  type ModeBDeps,
} from "@pipeline/eval/mode-b.js";
