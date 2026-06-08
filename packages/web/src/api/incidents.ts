import type {
  Incident,
  IncidentListFilter,
  IncidentStatus,
} from "@newsletter/shared/alerting";
import { apiFetchAdmin } from "./client";

/**
 * List incidents from the admin API.
 * Filters are optional; undefined fields are omitted from the query string.
 */
export async function listIncidents(
  filter?: IncidentListFilter,
): Promise<Incident[]> {
  const params = new URLSearchParams();
  if (filter?.status !== undefined) params.set("status", filter.status);
  if (filter?.severity !== undefined) params.set("severity", filter.severity);
  const qs = params.toString();
  const res = await apiFetchAdmin(
    `/api/admin/incidents${qs ? `?${qs}` : ""}`,
  );
  if (!res.ok) throw new Error(`listIncidents: ${String(res.status)}`);
  const raw = (await res.json()) as Record<string, unknown>[];
  // Dates come back as ISO strings from the API — convert to Date objects
  return raw.map(deserializeIncident);
}

/**
 * Update an incident's status.
 * Returns the updated incident.
 */
export async function setIncidentStatus(
  id: string,
  status: IncidentStatus,
): Promise<Incident> {
  const res = await apiFetchAdmin(`/api/admin/incidents/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`setIncidentStatus: ${String(res.status)}`);
  const raw = (await res.json()) as Record<string, unknown>;
  return deserializeIncident(raw);
}

function deserializeIncident(raw: Record<string, unknown>): Incident {
  return {
    id: raw.id as string,
    fingerprint: raw.fingerprint as string,
    severity: raw.severity as Incident["severity"],
    category: raw.category as Incident["category"],
    title: raw.title as string,
    message: raw.message as string,
    source: (raw.source as string | null | undefined) ?? null,
    runId: (raw.runId as string | null | undefined) ?? null,
    context: (raw.context as Incident["context"] | undefined) ?? {},
    status: raw.status as Incident["status"],
    occurrences: raw.occurrences as number,
    deliveryAttempts: raw.deliveryAttempts as number,
    firstSeenAt: new Date(raw.firstSeenAt as string),
    lastSeenAt: new Date(raw.lastSeenAt as string),
    notifiedAt:
      raw.notifiedAt != null
        ? new Date(raw.notifiedAt as string)
        : null,
  };
}
