// Node ≥22 ships an experimental `globalThis.localStorage` that is exposed as a
// broken stub (no `getItem` / `setItem` / `clear` methods) unless the process
// is started with `--localstorage-file <path>`. That broken global shadows
// jsdom's working implementation, so any test that touches `window.localStorage`
// fails with "is not a function". Install a Map-backed Storage stub on both
// `window` and `globalThis` so tests behave like a real browser.
if (typeof window !== "undefined") {
  function createStorage(): Storage {
    const store = new Map<string, string>();
    return {
      get length(): number {
        return store.size;
      },
      clear(): void {
        store.clear();
      },
      getItem(key: string): string | null {
        return store.get(key) ?? null;
      },
      key(index: number): string | null {
        return Array.from(store.keys())[index] ?? null;
      },
      removeItem(key: string): void {
        store.delete(key);
      },
      setItem(key: string, value: string): void {
        store.set(key, value);
      },
    };
  }
  for (const name of ["localStorage", "sessionStorage"] as const) {
    const value = createStorage();
    Object.defineProperty(window, name, {
      configurable: true,
      writable: true,
      value,
    });
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }
}

// jsdom doesn't implement ResizeObserver; stub it for Radix UI components that use it.
if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  const noop2 = (): void => undefined;
  class ResizeObserverStub {
    observe = noop2;
    unobserve = noop2;
    disconnect = noop2;
  }
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  });
}

// jsdom doesn't implement matchMedia; stub it for components (e.g. sonner) that read theme hints.
const noop = (): void => undefined;
const stubMatchMedia = (query: string): MediaQueryList => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: noop,
  removeListener: noop,
  addEventListener: noop,
  removeEventListener: noop,
  dispatchEvent: () => false,
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: stubMatchMedia,
  });
}

export {};
