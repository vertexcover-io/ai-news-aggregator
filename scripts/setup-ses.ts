#!/usr/bin/env tsx
/**
 * SES + SNS one-time setup script for the newsletter system.
 *
 * Idempotent: every step skips work that is already done.
 *
 * Usage:
 *   pnpm setup:ses [--domain news.vertexcover.io] [--region us-east-1]
 *   pnpm setup:ses --verify              # re-fetch identity status
 *   pnpm setup:ses --request-production-access   # prints AWS console URL
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import {
  SESv2Client,
  GetAccountCommand,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
} from "@aws-sdk/client-sesv2";
import {
  SNSClient,
  CreateTopicCommand,
} from "@aws-sdk/client-sns";

interface Args {
  domain: string;
  region: string;
  verify: boolean;
  requestProductionAccess: boolean;
  verifyEmail: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    domain: "news.vertexcover.io",
    region: "",
    verify: false,
    requestProductionAccess: false,
    verifyEmail: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--domain") {
      args.domain = argv[++i] ?? args.domain;
    } else if (a === "--region") {
      args.region = argv[++i] ?? args.region;
    } else if (a === "--verify") {
      args.verify = true;
    } else if (a === "--request-production-access") {
      args.requestProductionAccess = true;
    } else if (a === "--verify-email") {
      args.verifyEmail = argv[++i];
    }
  }
  return args;
}

function loadEnvHarness(): void {
  let gitCommonDir: string;
  try {
    gitCommonDir = execSync("git rev-parse --git-common-dir", { encoding: "utf8" }).trim();
  } catch {
    gitCommonDir = ".git";
  }
  const repoRoot = resolve(gitCommonDir, "..");
  const envPath = resolve(repoRoot, ".env.harness");
  if (!existsSync(envPath)) {
    console.error(`No .env.harness found at ${envPath}. AWS credentials are required.`);
    process.exit(1);
  }
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

interface SetupSummary {
  domain: string;
  region: string;
  account: { sandbox: boolean; sendQuota: { max24Hour?: number; sentLast24Hours?: number; maxSendRate?: number } } | null;
  identity: { existed: boolean; verifiedForSending?: boolean; dkimStatus?: string; dkimTokens: string[]; mailFromDomain?: string; mailFromStatus?: string };
  configurationSet: { name: string; existed: boolean };
  snsTopic: { arn: string; existed: boolean };
  eventDestination: { name: string; existed: boolean };
}

async function main(): Promise<void> {
  loadEnvHarness();
  const args = parseArgs(process.argv.slice(2));

  if (args.requestProductionAccess) {
    console.log("\nRequest SES production access via AWS console:");
    console.log("https://console.aws.amazon.com/ses/home#/account?dialog=sandbox-exit\n");
    return;
  }

  const region = args.region !== "" ? args.region : (process.env.AWS_REGION ?? "us-east-1");
  const domain = args.domain;

  if (args.verifyEmail !== undefined) {
    const ses = new SESv2Client({ region });
    const email = args.verifyEmail;
    try {
      await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: email }));
      console.log(`✓ Sent verification email to ${email}. Click the link to verify, then re-run with --verify-email ${email} to confirm status.`);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e.name === "AlreadyExistsException") {
        console.log(`Identity ${email} already exists.`);
      } else {
        console.error("CreateEmailIdentity failed:", e.message);
        process.exit(1);
      }
    }
    const identity = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: email }));
    console.log(`Status: VerifiedForSendingStatus=${String(identity.VerifiedForSendingStatus ?? false)}`);
    return;
  }

  console.log(`Configured: domain=${domain} region=${region}`);

  const ses = new SESv2Client({ region });
  const sns = new SNSClient({ region });

  const summary: SetupSummary = {
    domain,
    region,
    account: null,
    identity: { existed: false, dkimTokens: [] },
    configurationSet: { name: "newsletter-default", existed: false },
    snsTopic: { arn: "", existed: false },
    eventDestination: { name: "sns-all-events", existed: false },
  };

  // Step 1: Verify creds + read account state
  try {
    const acct = await ses.send(new GetAccountCommand({}));
    summary.account = {
      sandbox: !acct.ProductionAccessEnabled,
      sendQuota: {
        max24Hour: acct.SendQuota?.Max24HourSend,
        sentLast24Hours: acct.SendQuota?.SentLast24Hours,
        maxSendRate: acct.SendQuota?.MaxSendRate,
      },
    };
    console.log(
      `Step 1: account OK — sandbox=${summary.account.sandbox} max24h=${summary.account.sendQuota.max24Hour}`,
    );
  } catch (err) {
    console.error("Step 1: GetAccount failed:", (err as Error).message);
    process.exit(1);
  }

  // Step 2: Create domain identity (idempotent)
  try {
    await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: domain }));
    console.log(`Step 2: identity created for ${domain}`);
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === "AlreadyExistsException") {
      summary.identity.existed = true;
      console.log(`Step 2: identity already exists for ${domain}`);
    } else {
      console.error("Step 2: CreateEmailIdentity failed:", e.message);
      throw err;
    }
  }

  // Step 3: Get DKIM tokens
  const identity = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
  summary.identity.verifiedForSending = identity.VerifiedForSendingStatus;
  summary.identity.dkimStatus = identity.DkimAttributes?.Status;
  summary.identity.dkimTokens = identity.DkimAttributes?.Tokens ?? [];
  summary.identity.mailFromDomain = identity.MailFromAttributes?.MailFromDomain;
  summary.identity.mailFromStatus = identity.MailFromAttributes?.MailFromDomainStatus;
  console.log(
    `Step 3: dkim tokens=${summary.identity.dkimTokens.length} dkim_status=${summary.identity.dkimStatus} verified=${summary.identity.verifiedForSending}`,
  );

  // Step 4: Configure custom MAIL FROM
  const mailFromDomain = `mail.${domain}`;
  try {
    await ses.send(
      new PutEmailIdentityMailFromAttributesCommand({
        EmailIdentity: domain,
        MailFromDomain: mailFromDomain,
        BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
      }),
    );
    summary.identity.mailFromDomain = mailFromDomain;
    console.log(`Step 4: MAIL FROM configured to ${mailFromDomain}`);
  } catch (err) {
    console.warn("Step 4: PutEmailIdentityMailFromAttributes warn:", (err as Error).message);
  }

  // Step 5: Create configuration set
  try {
    await ses.send(
      new CreateConfigurationSetCommand({ ConfigurationSetName: summary.configurationSet.name }),
    );
    console.log(`Step 5: configuration set created: ${summary.configurationSet.name}`);
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === "AlreadyExistsException") {
      summary.configurationSet.existed = true;
      console.log(`Step 5: configuration set already exists: ${summary.configurationSet.name}`);
    } else {
      console.error("Step 5: CreateConfigurationSet failed:", e.message);
      throw err;
    }
  }

  // Step 6: Create SNS topic
  const topicName = "newsletter-ses-events";
  const topic = await sns.send(new CreateTopicCommand({ Name: topicName }));
  summary.snsTopic.arn = topic.TopicArn ?? "";
  // CreateTopic is idempotent in SNS; existed status not directly returned
  console.log(`Step 6: SNS topic ARN: ${summary.snsTopic.arn}`);

  // Step 7: Event destination on configuration set -> SNS
  try {
    await ses.send(
      new CreateConfigurationSetEventDestinationCommand({
        ConfigurationSetName: summary.configurationSet.name,
        EventDestinationName: summary.eventDestination.name,
        EventDestination: {
          Enabled: true,
          MatchingEventTypes: ["BOUNCE", "COMPLAINT", "DELIVERY", "OPEN", "CLICK", "REJECT"],
          SnsDestination: { TopicArn: summary.snsTopic.arn },
        },
      }),
    );
    console.log(`Step 7: event destination created: ${summary.eventDestination.name}`);
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === "AlreadyExistsException") {
      summary.eventDestination.existed = true;
      console.log(`Step 7: event destination already exists: ${summary.eventDestination.name}`);
    } else {
      console.error("Step 7: CreateConfigurationSetEventDestination failed:", e.message);
      throw err;
    }
  }

  // Step 8: Print summary + write DNS records file
  const dnsLines: string[] = [];
  dnsLines.push(`# DNS records to publish for ${domain}`);
  dnsLines.push(`# Generated: ${new Date().toISOString()}`);
  dnsLines.push("");
  dnsLines.push("## DKIM (3 CNAMEs)");
  for (const token of summary.identity.dkimTokens) {
    dnsLines.push(`CNAME  ${token}._domainkey.${domain}.  →  ${token}.dkim.amazonses.com.`);
  }
  dnsLines.push("");
  dnsLines.push("## MAIL FROM (SPF alignment)");
  dnsLines.push(`MX    ${mailFromDomain}.   priority=10  →  feedback-smtp.${region}.amazonses.com.`);
  dnsLines.push(`TXT   ${mailFromDomain}.   →  "v=spf1 include:amazonses.com -all"`);
  dnsLines.push("");
  dnsLines.push("## DMARC (recommended)");
  dnsLines.push(`TXT   _dmarc.${domain}.   →  "v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}"`);

  let gitCommonDir: string;
  try {
    gitCommonDir = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch {
    gitCommonDir = process.cwd();
  }
  const dnsFile = resolve(gitCommonDir, ".harness/features/ver-85-newsletter-system/ses-dns-records.txt");
  mkdirSync(dirname(dnsFile), { recursive: true });
  writeFileSync(dnsFile, dnsLines.join("\n") + "\n", "utf8");
  console.log(`Step 8: DNS records saved to ${dnsFile}`);

  console.log("\n=================== SUMMARY ===================");
  console.log(`Domain:               ${domain}`);
  console.log(`Region:               ${region}`);
  console.log(`Sandbox:              ${summary.account.sandbox}`);
  console.log(`Domain verified:      ${summary.identity.verifiedForSending}`);
  console.log(`DKIM status:          ${summary.identity.dkimStatus}`);
  const mailFromStatusLabel = summary.identity.mailFromStatus !== undefined && summary.identity.mailFromStatus !== "" ? summary.identity.mailFromStatus : "pending";
  console.log(`MAIL FROM domain:     ${summary.identity.mailFromDomain ?? mailFromDomain} (${mailFromStatusLabel})`);
  console.log(`Configuration set:    ${summary.configurationSet.name}`);
  console.log(`SNS topic ARN:        ${summary.snsTopic.arn}`);
  console.log(`Event destination:    ${summary.eventDestination.name}`);
  console.log("\nNext steps:");
  console.log("  1. Ask the manager to add the DNS records in ses-dns-records.txt to the news.vertexcover.io zone");
  console.log("  2. Wait ~5-30 minutes for AWS to detect and verify");
  console.log("  3. Re-run with --verify to confirm verification status");
  console.log("  4. Request production access (exit sandbox):");
  console.log("     pnpm setup:ses --request-production-access");
  console.log("  5. Once deployed, subscribe the production webhook URL to the SNS topic");
  console.log("===============================================\n");
}

main().catch((err: unknown) => {
  console.error("setup-ses failed:", err);
  process.exit(1);
});
