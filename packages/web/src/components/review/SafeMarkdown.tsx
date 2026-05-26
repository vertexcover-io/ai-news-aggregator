import type { ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import DOMPurify from "dompurify";

interface SafeMarkdownProps {
  markdown: string;
}

export function SafeMarkdown({ markdown }: SafeMarkdownProps): ReactElement {
  const sanitized = DOMPurify.sanitize(markdown);
  return <ReactMarkdown>{sanitized}</ReactMarkdown>;
}
