import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import plugin, { rules as typedRules } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const docsRulesDir = resolve(__dirname, "../docs/rules");

describe("@newsletter/eslint-plugin meta", () => {
  it("exposes the plugin name", () => {
    expect(plugin.meta?.name).toBe("@newsletter/eslint-plugin");
  });

  it("exposes a non-empty version string", () => {
    const version = plugin.meta?.version;
    expect(typeof version).toBe("string");
    expect(version).not.toBe("");
  });

  it("exposes a rules record", () => {
    expect(plugin.rules).toBeDefined();
    expect(typeof plugin.rules).toBe("object");
  });

  it("every rule has meta.type, meta.docs.description, meta.docs.url, meta.messages, and a docs file", () => {
    for (const [ruleName, rule] of Object.entries(typedRules)) {
      expect(rule.meta, `${ruleName}: meta`).toBeDefined();
      expect(rule.meta.type, `${ruleName}: meta.type`).toBeDefined();
      expect(rule.meta.docs, `${ruleName}: meta.docs`).toBeDefined();
      expect(
        rule.meta.docs?.description,
        `${ruleName}: meta.docs.description`,
      ).toBeTruthy();
      expect(rule.meta.docs?.url, `${ruleName}: meta.docs.url`).toBeTruthy();
      expect(rule.meta.messages, `${ruleName}: meta.messages`).toBeDefined();
      const docsPath = resolve(docsRulesDir, `${ruleName}.md`);
      expect(
        existsSync(docsPath),
        `${ruleName}: docs file at ${docsPath}`,
      ).toBe(true);
    }
  });
});
