import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { getTenantConfig, type TenantConfig } from "../../api/tenantConfig";

const TenantConfigContext = createContext<TenantConfig | null>(null);

function TenantConfigContent({
  config,
  children,
}: {
  config: TenantConfig | null;
  children: ReactNode;
}): ReactElement {
  // Default document title once branding loads; pages that set their own
  // title do so in child effects (which run first), so this only fills the
  // gap when the neutral index.html title is still in place.
  const neutralTitle = useRef(document.title);
  useEffect(() => {
    if (!config) return;
    if (document.title !== neutralTitle.current) return;
    document.title = config.headline
      ? `${config.name} — ${config.headline}`
      : config.name;
  }, [config]);

  return (
    <TenantConfigContext.Provider value={config}>
      {children}
    </TenantConfigContext.Provider>
  );
}

function FetchingTenantConfigProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const { data } = useQuery({
    queryKey: ["tenant-config"],
    queryFn: getTenantConfig,
    staleTime: Infinity,
    retry: false,
  });
  return (
    <TenantConfigContent config={data ?? null}>{children}</TenantConfigContent>
  );
}

interface TenantConfigProviderProps {
  children: ReactNode;
  /** Test/preview escape hatch: bypasses the network fetch entirely. */
  value?: TenantConfig | null;
}

export function TenantConfigProvider({
  children,
  value,
}: TenantConfigProviderProps): ReactElement {
  if (value !== undefined) {
    return <TenantConfigContent config={value}>{children}</TenantConfigContent>;
  }
  return <FetchingTenantConfigProvider>{children}</FetchingTenantConfigProvider>;
}

/** Tenant branding + feature flags; null while loading or on the app host. */
export function useTenantConfig(): TenantConfig | null {
  return useContext(TenantConfigContext);
}

/** Sets the document title from tenant branding once it is available. */
export function useTenantPageTitle(
  make: (config: TenantConfig) => string,
): void {
  const config = useTenantConfig();
  const makeRef = useRef(make);
  useEffect(() => {
    makeRef.current = make;
  });
  useEffect(() => {
    if (config) document.title = makeRef.current(config);
  }, [config]);
}
