export function withAbortSignal(
  baseFetch: typeof fetch,
  runSignal: AbortSignal,
): typeof fetch {
  return (input, init) => {
    const innerSignal = init?.signal;
    const signal = innerSignal
      ? AbortSignal.any([runSignal, innerSignal])
      : runSignal;
    return baseFetch(input, { ...init, signal });
  };
}
