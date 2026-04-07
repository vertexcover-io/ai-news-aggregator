export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  return fetch(path, { ...init, headers });
}
