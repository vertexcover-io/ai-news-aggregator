/**
 * Builds a per-tenant scheduler key using the ':' delimiter (D-112).
 *
 * The scheduler key format is: `pipeline-run:<tenantId>`.
 * This replaces the old `pipeline-run:default` singleton key.
 *
 * D-112: scheduler keys use `:` because BullMQ generates internal job ids
 * (`repeat:<key>:<ts>`) automatically; only custom `jobIdFor` ids passed
 * to `Queue.add` must avoid `:`.
 */
export function tenantPipelineRunSchedulerKey(tenantId: string): string {
  return `pipeline-run:${tenantId}`;
}
