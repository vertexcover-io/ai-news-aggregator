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
