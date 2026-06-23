/**
 * Fix #4: gates an admin route subtree on a tenant feature flag. While the flag
 * loads it renders nothing; when on it renders the nested route (`Outlet`); when
 * off it renders the disabled notice in place of the page. Modeled on
 * RequireAdmin. The matching API routes are also flag-gated (defense in depth).
 */
import { type ReactElement } from "react";
import { Outlet } from "react-router-dom";
import type { TenantFeatureFlagsWire } from "@newsletter/shared/types/tenant";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { FeatureDisabledNotice } from "@/components/admin/FeatureDisabledNotice";

export function RequireFeature({
  feature,
  label,
}: {
  feature: keyof TenantFeatureFlagsWire;
  label: string;
}): ReactElement | null {
  const { data, isLoading } = useFeatureFlags();

  if (isLoading) return null;
  if (data?.[feature]) return <Outlet />;
  return <FeatureDisabledNotice featureLabel={label} />;
}
