import { useCallback, useSyncExternalStore } from "react";
import {
  clearPassword,
  getPassword,
  setPassword as storePassword,
} from "../api/client";

type Listener = () => void;
const listeners = new Set<Listener>();

function emitAuthChange(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string | null {
  return getPassword();
}

export interface UseAuth {
  password: string | null;
  isAuthenticated: boolean;
  login: (password: string) => void;
  logout: () => void;
}

export function useAuth(): UseAuth {
  const password = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const login = useCallback((next: string): void => {
    storePassword(next);
    emitAuthChange();
  }, []);

  const logout = useCallback((): void => {
    clearPassword();
    emitAuthChange();
  }, []);

  return {
    password,
    isAuthenticated: password !== null && password.length > 0,
    login,
    logout,
  };
}
