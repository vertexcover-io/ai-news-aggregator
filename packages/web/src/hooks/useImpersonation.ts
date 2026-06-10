import { useCallback, useSyncExternalStore } from "react";

// Impersonation state lives server-side in the session cookie. Until a
// `GET /api/auth/me` endpoint exists (DEFERRED — see prereq report), the
// client mirrors it in sessionStorage: SuperAdminPage records the target on a
// successful `impersonate()`, ImpersonationBanner clears it on exit. This keeps
// the banner visible across reloads within the impersonation session without
// hardcoding any tenant identity into a component.

const STORAGE_KEY = "newsletter.impersonation";

export interface ImpersonationState {
  tenantId: string;
  tenantName: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): ImpersonationState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ImpersonationState>;
    if (typeof parsed.tenantId !== "string") return null;
    return {
      tenantId: parsed.tenantId,
      tenantName:
        typeof parsed.tenantName === "string" ? parsed.tenantName : "",
    };
  } catch {
    return null;
  }
}

let snapshot: ImpersonationState | null = read();

function emit(): void {
  snapshot = read();
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent): void => {
    if (e.key === STORAGE_KEY || e.key === null) emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function startImpersonation(state: ImpersonationState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  emit();
}

export function clearImpersonation(): void {
  sessionStorage.removeItem(STORAGE_KEY);
  emit();
}

export interface UseImpersonation {
  state: ImpersonationState | null;
  isImpersonating: boolean;
  start: (state: ImpersonationState) => void;
  clear: () => void;
}

export function useImpersonation(): UseImpersonation {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => null,
  );
  const start = useCallback((next: ImpersonationState) => {
    startImpersonation(next);
  }, []);
  const clear = useCallback(() => {
    clearImpersonation();
  }, []);
  return {
    state,
    isImpersonating: state !== null,
    start,
    clear,
  };
}
