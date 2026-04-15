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
