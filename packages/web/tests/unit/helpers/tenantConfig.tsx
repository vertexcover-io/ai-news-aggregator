import type { ReactElement, ReactNode } from "react";
import { TenantConfigProvider } from "../../../src/components/shell/TenantConfigProvider";
import type { TenantConfig, TenantFlags } from "../../../src/api/tenantConfig";

type ConfigOverrides = Partial<Omit<TenantConfig, "flags">> & {
  flags?: Partial<TenantFlags>;
};

/** AGENTLOOP-shaped tenant config (matches the tenant-0 API defaults). */
export function makeTenantConfig(overrides: ConfigOverrides = {}): TenantConfig {
  const { flags, ...rest } = overrides;
  return {
    name: "AGENTLOOP",
    slug: "agentloop",
    headline: "The daily read for people who ship with agents.",
    topicStrip:
      "AGENTIC CODING · HARNESS ENGINEERING · CONTEXT ENGINEERING · THE SOFTWARE FACTORY",
    subtagline:
      "No model releases. No benchmarks. No discourse. Just the craft.",
    logoVersion: 0,
    flags: { canon: true, built: true, deliverability: false, ...flags },
    ...rest,
  };
}

export function withTenantConfig(
  children: ReactNode,
  config: TenantConfig | null = makeTenantConfig(),
): ReactElement {
  return <TenantConfigProvider value={config}>{children}</TenantConfigProvider>;
}
