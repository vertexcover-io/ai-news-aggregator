// One-off: render the canonical AgentLoop SVG mark to a crisp transparent PNG
// for use in email (Gmail/Outlook don't render SVG <img>).
const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const SVG = fs.readFileSync(path.join(ROOT, "packages/web/public/agentloop-mark.svg"), "utf8")
  .replace('width="100"', 'width="240"')
  .replace('height="100"', 'height="240"');
const OUT = path.join(ROOT, "packages/web/public/agentloop-mark.png");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 240, height: 240 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${SVG}</body></html>`);
  const el = await page.$("svg");
  await el.screenshot({ path: OUT, omitBackground: true });
  await browser.close();
  console.log("wrote", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
