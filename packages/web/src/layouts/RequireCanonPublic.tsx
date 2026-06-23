/**
 * Fix #4: gates the public Must Read page on the tenant's canon flag. The nav
 * links to it are already hidden when canon is off (Masthead/Footer); this also
 * blocks the route itself so a stray/deep link redirects home rather than
 * rendering a page the tenant has disabled.
 */
import { type ReactElement } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useTenantBranding } from "@/hooks/useTenantBranding";

export function RequireCanonPublic(): ReactElement {
  const branding = useTenantBranding();
  if (!branding.flags.canon) return <Navigate to="/" replace />;
  return <Outlet />;
}
