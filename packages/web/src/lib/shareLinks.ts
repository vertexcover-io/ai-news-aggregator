const X_RESERVED_FOR_URL = 24;
const X_TWEET_LIMIT = 280;

export function truncateForX(text: string, reservedForUrl: number): string {
  const budget = X_TWEET_LIMIT - reservedForUrl;
  if (text.length <= budget) return text;
  return text.slice(0, budget - 1) + "…";
}

export function buildLinkedInShareUrl(archiveUrl: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(archiveUrl)}`;
}

export function buildXShareUrl(archiveUrl: string, shareText: string): string {
  const truncated = truncateForX(shareText, X_RESERVED_FOR_URL);
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(truncated)}&url=${encodeURIComponent(archiveUrl)}`;
}
