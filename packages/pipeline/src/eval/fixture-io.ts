import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  FIXTURES_DIR,
  GROUNDTRUTH_DIR,
} from "@newsletter/shared/constants/eval-ranking";
import {
  FixtureSchema,
  GroundTruthSchema,
} from "@newsletter/shared/types/eval-ranking-schemas";
import type {
  Fixture,
  GroundTruth,
} from "@newsletter/shared/types/eval-ranking";

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(value, null, 2), "utf8");
  await rename(tmpPath, path);
}

export async function listFixtures(
  dir: string = FIXTURES_DIR,
): Promise<Fixture[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const fixtures: Fixture[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      console.warn(`[fixture-io] failed to read ${path}: ${String(err)}`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(`[fixture-io] invalid JSON in ${path}: ${String(err)}`);
      continue;
    }
    const validated = FixtureSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn(
        `[fixture-io] schema mismatch in ${path}: ${validated.error.message}`,
      );
      continue;
    }
    fixtures.push(validated.data as Fixture);
  }
  return fixtures;
}

export async function readFixture(
  fixtureId: string,
  dir: string = FIXTURES_DIR,
): Promise<Fixture> {
  const path = join(dir, `${fixtureId}.json`);
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return FixtureSchema.parse(parsed) as Fixture;
}

export async function writeFixture(
  fixture: Fixture,
  dir: string = FIXTURES_DIR,
): Promise<string> {
  const path = join(dir, `${fixture.fixtureId}.json`);
  await atomicWriteJson(path, fixture);
  return path;
}

export async function readGroundTruth(
  fixtureId: string,
  dir: string = GROUNDTRUTH_DIR,
): Promise<GroundTruth | null> {
  const path = join(dir, `${fixtureId}.json`);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const parsed = JSON.parse(raw) as unknown;
  return GroundTruthSchema.parse(parsed) as GroundTruth;
}

export async function writeGroundTruth(
  gt: GroundTruth,
  dir: string = GROUNDTRUTH_DIR,
): Promise<string> {
  const path = join(dir, `${gt.fixtureId}.json`);
  const existing = await readGroundTruth(gt.fixtureId, dir);
  const mergedGradedBy = existing
    ? [
        ...existing.gradedBy,
        ...gt.gradedBy.filter((g) => !existing.gradedBy.includes(g)),
      ]
    : gt.gradedBy;
  const merged: GroundTruth = {
    fixtureId: gt.fixtureId,
    gradedBy: mergedGradedBy,
    gradedAt: gt.gradedAt,
    labels: gt.labels,
  };
  await atomicWriteJson(path, merged);
  return path;
}
