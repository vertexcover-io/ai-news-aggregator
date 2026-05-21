import {
  archiveContextLine,
  headerBlock,
  renderPermalink,
  sectionMarkdown,
} from "./_helpers.js";

export function buildTwitterPostedMessage(args: {
  runId: string;
  headline: string | null;
  permalink: string;
  publicArchiveBaseUrl?: string;
}): { blocks: unknown[] } {
  const blocks: unknown[] = [];

  blocks.push(headerBlock("🟢 X (Twitter) posted"));

  if (args.headline !== null && args.headline.length > 0) {
    blocks.push(sectionMarkdown(`*${args.headline}*`));
  }

  blocks.push(sectionMarkdown(renderPermalink(args.permalink)));

  blocks.push(archiveContextLine(args.runId, args.publicArchiveBaseUrl));

  return { blocks };
}
