import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import rule from "../../src/rules/collector-return-shape.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(__dirname, "../fixtures");

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: {
        allowDefaultProject: ["*.ts"],
        defaultProject: "tsconfig.json",
      },
      tsconfigRootDir: FIXTURE_ROOT,
    },
  },
});

const COLLECTOR_RESULT_DECL = `interface CollectorResult { itemsFetched: number; errors: number; }`;

ruleTester.run("collector-return-shape", rule, {
  valid: [
    {
      name: "REQ-060: exported async function returning Promise<CollectorResult>",
      code: [
        COLLECTOR_RESULT_DECL,
        `export async function collectX(): Promise<CollectorResult> {`,
        `  return { itemsFetched: 0, errors: 0 };`,
        `}`,
      ].join("\n"),
    },
    {
      name: "REQ-060: exported arrow function returning Promise<CollectorResult>",
      code: [
        COLLECTOR_RESULT_DECL,
        `export const collectX = async (): Promise<CollectorResult> => ({ itemsFetched: 0, errors: 0 });`,
      ].join("\n"),
    },
    {
      name: "EDGE-005: type alias resolving to CollectorResult is accepted",
      code: [
        COLLECTOR_RESULT_DECL,
        `type MyAlias = CollectorResult;`,
        `export async function collectX(): Promise<MyAlias> {`,
        `  return { itemsFetched: 0, errors: 0 };`,
        `}`,
      ].join("\n"),
    },
    {
      name: "exported helper whose name does not start with `collect` is ignored",
      code: [
        `export function buildRawItem(): { id: number } {`,
        `  return { id: 1 };`,
        `}`,
        `export async function fetchMarkdown(): Promise<string> {`,
        `  return "x";`,
        `}`,
      ].join("\n"),
    },
    {
      name: "non-exported function with wrong return type is not flagged",
      code: [
        COLLECTOR_RESULT_DECL,
        `async function helper(): Promise<number> { return 1; }`,
        `export async function collectX(): Promise<CollectorResult> {`,
        `  await helper();`,
        `  return { itemsFetched: 0, errors: 0 };`,
        `}`,
      ].join("\n"),
    },
    {
      name: "EDGE-012: .d.ts files are skipped entirely",
      filename: path.join(FIXTURE_ROOT, "fake.d.ts"),
      code: [
        `export declare function collectX(): Promise<{ items: number }>;`,
      ].join("\n"),
    },
    {
      name: "subtype that extends CollectorResult is accepted",
      code: [
        COLLECTOR_RESULT_DECL,
        `interface ExtendedResult extends CollectorResult { failures?: string[]; }`,
        `export async function collectX(): Promise<ExtendedResult> {`,
        `  return { itemsFetched: 0, errors: 0 };`,
        `}`,
      ].join("\n"),
    },
  ],
  invalid: [
    {
      name: "REQ-060: Promise of an unrelated object literal",
      code: [
        `export async function collectX(): Promise<{ items: number }> {`,
        `  return { items: 0 };`,
        `}`,
      ].join("\n"),
      errors: [{ messageId: "wrongReturnType" }],
    },
    {
      name: "REQ-060: Promise<void> is rejected",
      code: [
        `export async function collectX(): Promise<void> {}`,
      ].join("\n"),
      errors: [{ messageId: "wrongReturnType" }],
    },
    {
      name: "REQ-060: synchronous CollectorResult (not wrapped in Promise) is rejected",
      code: [
        COLLECTOR_RESULT_DECL,
        `export function collectX(): CollectorResult {`,
        `  return { itemsFetched: 0, errors: 0 };`,
        `}`,
      ].join("\n"),
      errors: [{ messageId: "wrongReturnType" }],
    },
    {
      name: "REQ-060: arrow function returning Promise<number>",
      code: [
        `export const collectX = async (): Promise<number> => 1;`,
      ].join("\n"),
      errors: [{ messageId: "wrongReturnType" }],
    },
  ],
});
