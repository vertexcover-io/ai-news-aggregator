import { useQuery } from "@tanstack/react-query";
import {
  getTenantSettings,
  type TenantSettings,
} from "../pages/admin/SettingsPageApi";
import { useSession } from "./useSession";

export interface TenantFeatures {
  canonEnabled: boolean;
  deliverabilityEnabled: boolean;
  evalEnabled: boolean;
}

const OFF: TenantFeatures = {
  canonEnabled: false,
  deliverabilityEnabled: false,
  evalEnabled: false,
};

/**
 * Session-scoped feature flags for the admin UI (REQ-093): gate the Canon /
 * Eval / Analytics nav links and surfaces. Defaults to all-off until the
 * settings load (toggles default off, so hiding is the safe fallback).
 * Shares the ["settings"] cache with the settings page. Disabled when the
 * session has no effective tenant (bare super admin) — /api/settings would
 * 500 there and spam error tracking on every admin page view.
 */
export function useTenantFeatures(): TenantFeatures {
  const { tenant } = useSession();
  const { data } = useQuery<TenantSettings | null>({
    queryKey: ["settings"],
    queryFn: getTenantSettings,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    enabled: tenant !== null,
  });
  if (!data) return OFF;
  return {
    canonEnabled: data.canonEnabled,
    deliverabilityEnabled: data.deliverabilityEnabled,
    evalEnabled: data.evalEnabled,
  };
}
