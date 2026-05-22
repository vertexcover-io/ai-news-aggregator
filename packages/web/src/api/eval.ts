import type {
  Fixture,
  GroundTruth,
} from "@newsletter/shared/types/eval-ranking";
import { apiFetchAdmin } from "./client";

export class EvalApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "EvalApiError";
    this.status = status;
    this.body = body;
  }
}

async function readErrorBody(
  res: Response,
): Promise<{ message: string; body: unknown }> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const message =
    (body as { error?: string } | undefined)?.error ??
    `request failed (${String(res.status)})`;
  return { message, body };
}

export interface EvalFixtureResponse {
  fixture: Fixture;
  groundTruth: GroundTruth | null;
}

export async function getEvalFixture(id: string): Promise<EvalFixtureResponse> {
  const res = await apiFetchAdmin(
    `/api/admin/eval/fixtures/${encodeURIComponent(id)}`,
  );
  if (!res.ok) {
    const { message, body } = await readErrorBody(res);
    throw new EvalApiError(message, res.status, body);
  }
  return (await res.json()) as EvalFixtureResponse;
}

export async function saveGroundTruth(
  fixtureId: string,
  gt: GroundTruth,
): Promise<GroundTruth> {
  const res = await apiFetchAdmin(
    `/api/admin/eval/groundtruth/${encodeURIComponent(fixtureId)}`,
    {
      method: "POST",
      body: JSON.stringify(gt),
    },
  );
  if (!res.ok) {
    const { message, body } = await readErrorBody(res);
    throw new EvalApiError(message, res.status, body);
  }
  const payload = (await res.json()) as { groundTruth: GroundTruth };
  return payload.groundTruth;
}

export async function saveGroundTruthToRepo(
  fixtureId: string,
  gt: GroundTruth,
): Promise<{ ok: true }> {
  const res = await apiFetchAdmin(
    `/api/admin/eval/groundtruth/${encodeURIComponent(fixtureId)}/save-to-repo`,
    {
      method: "POST",
      body: JSON.stringify(gt),
    },
  );
  if (!res.ok) {
    const { message, body } = await readErrorBody(res);
    throw new EvalApiError(message, res.status, body);
  }
  return (await res.json()) as { ok: true };
}

export interface CreateManualFixtureResponse {
  fixtureId: string;
  itemCount: number;
}

export async function createManualFixture(
  urls: string[],
  name?: string,
): Promise<CreateManualFixtureResponse> {
  const body: { urls: string[]; name?: string } = { urls };
  if (name && name.trim().length > 0) body.name = name.trim();
  const res = await apiFetchAdmin("/api/admin/eval/fixtures", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const { message, body: errBody } = await readErrorBody(res);
    throw new EvalApiError(message, res.status, errBody);
  }
  const data = (await res.json()) as {
    fixtureId: string;
    itemCount: number;
  };
  return { fixtureId: data.fixtureId, itemCount: data.itemCount };
}
