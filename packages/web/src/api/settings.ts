import type { UserSettings } from "@newsletter/shared";
import { apiFetchAdmin } from "./client";

export type UserSettingsUpsertInput = Omit<UserSettings, "id" | "updatedAt">;

interface ApiErrorBody {
  error?: string;
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
    throw new Error(body.error ?? "Failed to save settings");
  }
  return (await res.json()) as UserSettings;
}
