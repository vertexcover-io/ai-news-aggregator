// LinkedIn's Posts API parses the `commentary` field as "little Text Format"
// (LTF). Every reserved LTF character must be backslash-escaped or LinkedIn
// silently drops everything from the first unescaped reserved char onward —
// e.g. an unescaped ")" in a "1) ..." list line truncates the whole post.
// Reserved set per the LTF grammar:
// https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
//
// The backslash itself is reserved, so it MUST be escaped first; otherwise the
// backslashes we add for the other characters would themselves be re-escaped.
const LTF_RESERVED = /[\\|{}@[\]()<>#*_~]/g;

export function escapeLittleText(text: string): string {
  return text.replace(LTF_RESERVED, (char) => `\\${char}`);
}
