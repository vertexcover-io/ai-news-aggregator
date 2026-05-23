export function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  const ipv6 = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : null;
  if (ipv6 !== null) {
    if (ipv6 === "::1" || ipv6 === "::") return true;
    if (ipv6.startsWith("fc") || ipv6.startsWith("fd") || ipv6.startsWith("fe80:")) return true;
    return false;
  }
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  if (h.startsWith("127.")) return true;
  if (h.startsWith("10.")) return true;
  if (h.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h.startsWith("169.254.")) return true;
  return false;
}

export function canonicalizeFetchUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  parsed.hostname = parsed.hostname.toLowerCase();
  if (isPrivateOrLoopbackHost(parsed.hostname)) return null;
  return parsed.toString();
}
