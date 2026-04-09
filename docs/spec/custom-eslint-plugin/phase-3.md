# Phase 3: `newsletter/no-bundled-readfilesync` + `newsletter/no-raw-alter-table`

> **Status:** pending

## Overview

Ship two more syntactic custom rules that catch recurring traps documented in `.claude/rules/learnings/`. Neither rule needs type information, so both are straightforward AST matchers. Both land in the same phase because they're small and related ("don't do X at a site" patterns).

## Implementation

**Files to create:**
- `packages/eslint-plugin/src/rules/no-bundled-readfilesync.ts`
- `packages/eslint-plugin/tests/rules/no-bundled-readfilesync.test.ts`
- `packages/eslint-plugin/docs/rules/no-bundled-readfilesync.md`
- `packages/eslint-plugin/src/rules/no-raw-alter-table.ts`
- `packages/eslint-plugin/tests/rules/no-raw-alter-table.test.ts`
- `packages/eslint-plugin/docs/rules/no-raw-alter-table.md`

**Files to modify:**
- `packages/eslint-plugin/src/index.ts` — register both new rules
- `eslint.config.mjs` (root) — wire both rules at `"warn"` scoped to pipeline+api
- `packages/eslint-plugin/docs/rules/README.md` — add both rules to the index

### Rule 1: `newsletter/no-bundled-readfilesync`

**Intent:** Flag `readFileSync` calls whose first argument resolves paths via `new URL(..., import.meta.url)` or `__dirname`. These break after tsup bundling.

**Selector:** `CallExpression[callee.property.name="readFileSync"], CallExpression[callee.name="readFileSync"]`

**Logic:**
```ts
CallExpression(node) {
  // Match readFileSync(...) regardless of import shape
  const isReadFileSync =
    (node.callee.type === "Identifier" && node.callee.name === "readFileSync") ||
    (node.callee.type === "MemberExpression" &&
      node.callee.property.type === "Identifier" &&
      node.callee.property.name === "readFileSync");
  if (!isReadFileSync) return;

  const arg0 = node.arguments[0];
  if (!arg0) return;

  // Case 1: new URL(..., import.meta.url) — walk and look for MetaProperty
  const hasImportMetaUrl = (n: TSESTree.Node): boolean => {
    if (n.type === "MetaProperty" &&
        n.meta.name === "import" &&
        n.property.name === "meta") return true;
    // recurse one level for new URL(x, import.meta.url)
    if (n.type === "NewExpression" && n.callee.type === "Identifier" && n.callee.name === "URL") {
      return n.arguments.some(hasImportMetaUrl);
    }
    if (n.type === "MemberExpression") return hasImportMetaUrl(n.object);
    if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "fileURLToPath") {
      return n.arguments.some(hasImportMetaUrl);
    }
    return false;
  };
  if (hasImportMetaUrl(arg0)) {
    context.report({ node: arg0, messageId: "bundledUrlRead" });
    return;
  }

  // Case 2: argument contains a __dirname identifier reference
  const hasDirname = (n: TSESTree.Node): boolean => {
    if (n.type === "Identifier" && n.name === "__dirname") return true;
    if (n.type === "BinaryExpression") return hasDirname(n.left) || hasDirname(n.right);
    if (n.type === "TemplateLiteral") return n.expressions.some(hasDirname);
    if (n.type === "CallExpression") return n.arguments.some(hasDirname);
    return false;
  };
  if (hasDirname(arg0)) {
    context.report({ node: arg0, messageId: "bundledDirnameRead" });
  }
},
```

**Messages:**
- `bundledUrlRead`: "readFileSync with `new URL(..., import.meta.url)` breaks after tsup bundling. Inline the asset as a TypeScript const string instead. See `.claude/rules/learnings/bundled-assets-need-import-not-readfilesync.md`."
- `bundledDirnameRead`: "readFileSync resolving via `__dirname` breaks after tsup bundling. Inline the asset as a TypeScript const string instead."

**Scope in root config:** `packages/pipeline/src/**/*.ts` and `packages/api/src/**/*.ts`.

### Rule 2: `newsletter/no-raw-alter-table`

**Intent:** Flag `db.execute(...)` or any `.execute(...)` call whose first argument is a literal or template literal matching `/ALTER\s+TABLE/i`. Variable arguments are out of scope (EDGE-010).

**Logic:**
```ts
CallExpression(node) {
  // Match `.execute(...)` member calls
  if (node.callee.type !== "MemberExpression") return;
  if (node.callee.property.type !== "Identifier" || node.callee.property.name !== "execute") return;

  const arg0 = node.arguments[0];
  if (!arg0) return;

  const ALTER_TABLE = /ALTER\s+TABLE/i;

  // String literal
  if (arg0.type === "Literal" && typeof arg0.value === "string" && ALTER_TABLE.test(arg0.value)) {
    context.report({ node: arg0, messageId: "rawAlterTable" });
    return;
  }

  // Template literal — concatenate quasi text and scan
  if (arg0.type === "TemplateLiteral") {
    const rawText = arg0.quasis.map((q) => q.value.raw).join("");
    if (ALTER_TABLE.test(rawText)) {
      context.report({ node: arg0, messageId: "rawAlterTable" });
    }
  }
},
```

**Message:**
- `rawAlterTable`: "Raw `ALTER TABLE` via `.execute()` is forbidden. Use a Drizzle Kit migration instead. See `.claude/rules/database.md`."

**Scope in root config:** `packages/pipeline/src/**/*.ts` and `packages/api/src/**/*.ts`.

## What to test (RuleTester)

### `no-bundled-readfilesync`

**Valid:**
- `const x = readFileSync("./static-path.txt");` (literal path is fine)
- `const x = fs.readFileSync(someVarFromArg, "utf8");` (variable arg, not trackable)
- Test file under `tests/**` path doesn't apply (scope excludes tests via root config — but RuleTester tests the rule logic irrespective of scope)

**Invalid:**
- `readFileSync(new URL("./prompt.md", import.meta.url), "utf8")` → `bundledUrlRead`
- `readFileSync(fileURLToPath(new URL("./prompt.md", import.meta.url)), "utf8")` → `bundledUrlRead`
- `readFileSync(path.join(__dirname, "file.txt"), "utf8")` → `bundledDirnameRead`
- `fs.readFileSync(new URL("./x", import.meta.url))` → `bundledUrlRead` (member shape)
- Aliased: `import { readFileSync as rfs } from "fs"; rfs(new URL(...))` → EDGE: **skipped** — matching by source name only, not alias tracking (too complex for v1). Document this limitation in the rule's docs page.

### `no-raw-alter-table`

**Valid:**
- `db.execute(sql\`SELECT 1\`)` — string doesn't match regex
- `db.execute(someQueryVar)` — variable, not inspected (EDGE-010)
- `db.insert(...)` — different method

**Invalid:**
- `db.execute("ALTER TABLE foo ADD COLUMN bar")` → `rawAlterTable`
- `db.execute(\`ALTER TABLE ${table} RENAME TO baz\`)` → `rawAlterTable` (regex matches the raw template text)
- Case insensitive: `db.execute("alter   table foo ...")` → `rawAlterTable`

**Traces to:** REQ-040, REQ-041, REQ-042, REQ-043, REQ-070, REQ-071, EDGE-004 (rationale comment), EDGE-010 (documented non-behavior)

**Commit:** `feat(VER): add no-bundled-readfilesync + no-raw-alter-table rules`

## Done When

- [ ] Both rules + tests + docs pages exist
- [ ] `pnpm --filter @newsletter/eslint-plugin test:unit` passes the expanded suite
- [ ] Meta walker confirms both rules have docs URLs and docs files
- [ ] `pnpm lint` at root runs clean (no pre-existing violations expected)
- [ ] `pnpm typecheck`, `pnpm test:unit` still pass monorepo-wide
- [ ] Each rule's docs page explicitly documents its limitations (alias tracking for readFileSync; variable arguments for alter-table)
