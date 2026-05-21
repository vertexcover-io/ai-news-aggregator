import type { DeliveryCounts } from "../types.js";
import {
  archiveContextLine,
  headerBlock,
  sectionMarkdown,
  truncate,
} from "./_helpers.js";

export function buildEmailDeliveryMessage(args: {
  runId: string;
  headline: string | null;
  delivery: DeliveryCounts;
  publicArchiveBaseUrl?: string;
}): { blocks: unknown[] } {
  const blocks: unknown[] = [];

  blocks.push(headerBlock("📬 Newsletter emailed"));

  if (args.headline !== null && args.headline.length > 0) {
    blocks.push(sectionMarkdown(`*${args.headline}*`));
  }

  const { attempted, sent, failed, failureReasons } = args.delivery;
  const recipientWord = attempted === 1 ? "subscriber" : "subscribers";
  const distributionLines: string[] = [];
  if (failed === 0 && attempted === sent) {
    distributionLines.push(`Sent to ${sent} ${recipientWord}.`);
  } else {
    distributionLines.push(
      `Sent to ${sent}/${attempted} ${recipientWord} (${failed} failed).`,
    );
    if (failureReasons !== undefined && failureReasons.length > 0) {
      const top = failureReasons.slice(0, 3);
      for (const r of top) {
        distributionLines.push(`  ◦ ${r.count}× ${truncate(r.reason)}`);
      }
      const remaining = failureReasons.length - top.length;
      if (remaining > 0) {
        const otherCount = failureReasons
          .slice(3)
          .reduce((acc, r) => acc + r.count, 0);
        distributionLines.push(`  ◦ ${otherCount}× other (${remaining} more reasons)`);
      }
    }
  }
  blocks.push(sectionMarkdown(distributionLines.join("\n")));

  blocks.push(archiveContextLine(args.runId, args.publicArchiveBaseUrl));

  return { blocks };
}
