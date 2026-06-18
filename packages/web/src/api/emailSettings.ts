/**
 * Email-settings API client (Fix #3, Phase B) — backs the Settings EmailPanel.
 */
import type {
  EmailMode,
  EmailSettingsWire,
  SmtpInput,
} from "@newsletter/shared/types/tenant";
import { apiFetchAdmin } from "./client";

export class EmailSettingsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "EmailSettingsApiError";
    this.status = status;
  }
}

async function readError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new EmailSettingsApiError(body.error ?? fallback, res.status);
}

export interface EmailSettingsInput {
  mode: EmailMode;
  smtp?: SmtpInput;
}

export async function getEmailSettings(): Promise<EmailSettingsWire> {
  const res = await apiFetchAdmin("/api/settings/email");
  if (!res.ok) await readError(res, "Failed to load email settings");
  return (await res.json()) as EmailSettingsWire;
}

export async function putEmailSettings(
  input: EmailSettingsInput,
): Promise<EmailSettingsWire> {
  const res = await apiFetchAdmin("/api/settings/email", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (!res.ok) await readError(res, "Failed to save email settings");
  return (await res.json()) as EmailSettingsWire;
}
