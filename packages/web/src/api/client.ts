export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  return fetch(path, { ...init, credentials: "include", headers });
}

export async function apiFetchAdmin(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await apiFetch(path, init);
  if (
    res.status === 401 &&
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/admin")
  ) {
    const next = encodeURIComponent(
      window.location.pathname + window.location.search,
    );
    window.location.assign(`/login?next=${next}`);
  }
  return res;
}
