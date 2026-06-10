import { onboardingProgress, tenantScope } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { OnboardingProgressRow, TenantContext } from "@newsletter/shared";

export interface OnboardingProgressRepo {
  get(): Promise<OnboardingProgressRow | null>;
  upsert(
    furthestStep: number,
    data: Record<string, unknown>,
  ): Promise<OnboardingProgressRow>;
}

export function createOnboardingProgressRepo(
  db: Pick<AppDb, "select" | "insert">,
  ctx?: TenantContext,
): OnboardingProgressRepo {
  const scope = tenantScope(onboardingProgress.tenantId, ctx);
  return {
    async get(): Promise<OnboardingProgressRow | null> {
      const rows = await db
        .select()
        .from(onboardingProgress)
        .where(scope.where())
        .limit(1);
      return rows[0] ?? null;
    },

    async upsert(
      furthestStep: number,
      data: Record<string, unknown>,
    ): Promise<OnboardingProgressRow> {
      const values = { furthestStep, data, updatedAt: new Date() };
      const [row] = await db
        .insert(onboardingProgress)
        .values(scope.stamp(values))
        .onConflictDoUpdate({
          target: onboardingProgress.tenantId,
          set: values,
        })
        .returning();
      return row;
    },
  };
}
