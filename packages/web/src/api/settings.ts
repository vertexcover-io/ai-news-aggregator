import type { UserSettings } from "@newsletter/shared";
import { apiFetchAdmin } from "./client";
import type { SettingsSubmitInput } from "../pages/settingsSchema";

export type UserSettingsUpsertInput = SettingsSubmitInput;

export interface TwitterHandleFailure {
  handle: string;
  reason: string;
}

interface ApiErrorBody {
  error?: string;
  failures?: TwitterHandleFailure[];
}

export class SettingsApiError extends Error {
  readonly status: number;
  readonly failures: TwitterHandleFailure[];

  constructor(message: string, status: number, failures: TwitterHandleFailure[]) {
    super(message);
    this.name = "SettingsApiError";
    this.status = status;
    this.failures = failures;
  }
}

export async function getSettings(): Promise<UserSettings | null> {
  const res = await apiFetchAdmin("/api/settings");
  if (!res.ok) throw new Error("Failed to fetch settings");
  return (await res.json()) as UserSettings | null;
}

export async function putSettings(
  input: UserSettingsUpsertInput,
): Promise<UserSettings> {
  const res = await apiFetchAdmin("/api/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    const message = body.error ?? "Failed to save settings";
    const failures = body.failures ?? [];
    throw new SettingsApiError(message, res.status, failures);
  }
  return (await res.json()) as UserSettings;
}
